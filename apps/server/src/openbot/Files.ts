// @effect-diagnostics nodeBuiltinImport:off -- Stream hashing is the binary transport boundary.
import * as NodeCrypto from "node:crypto";
import {
  OpenbotFilesError,
  OpenbotMaterializedFile as MaterializedSchema,
  OpenbotDraftFile as DraftSchema,
  OpenbotFileSummary as SummarySchema,
  OpenbotFileTarget as TargetSchema,
  type OpenbotFileScope,
  type OpenbotWorkspaceListInput,
  type OpenbotWorkspaceDirectory,
  type OpenbotConversationFileSearchInput,
  type OpenbotConversationFilePage,
  type OpenbotFileMaterializeInput,
  type OpenbotMaterializedFile,
  type OpenbotFileUploadInput,
  type OpenbotDraftFile,
  type OpenbotFileSendInput,
  type OpenbotFileDiscardInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import * as ServerConfig from "../config.ts";
import {
  attachmentFileExtension,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";

export class Files extends Context.Service<
  Files,
  {
    readonly listWorkspace: (
      input: OpenbotWorkspaceListInput,
    ) => Effect.Effect<OpenbotWorkspaceDirectory, OpenbotFilesError>;
    readonly search: (
      input: OpenbotConversationFileSearchInput,
    ) => Effect.Effect<OpenbotConversationFilePage, OpenbotFilesError>;
    readonly materialize: (
      input: OpenbotFileMaterializeInput,
    ) => Effect.Effect<OpenbotMaterializedFile, OpenbotFilesError>;
    readonly uploadDraft: (
      input: OpenbotFileUploadInput,
    ) => Effect.Effect<OpenbotDraftFile, OpenbotFilesError>;
    readonly listDrafts: (
      input: OpenbotFileScope,
    ) => Effect.Effect<readonly OpenbotDraftFile[], OpenbotFilesError>;
    readonly sendDraft: (
      input: OpenbotFileSendInput,
    ) => Effect.Effect<OpenbotDraftFile, OpenbotFilesError>;
    readonly discardDraft: (
      input: OpenbotFileDiscardInput,
    ) => Effect.Effect<void, OpenbotFilesError>;
  }
>()("t3/openbot/Files") {}

const decodeMaterialized = Schema.decodeUnknownEffect(MaterializedSchema);
const decodeDraft = Schema.decodeUnknownEffect(DraftSchema);
const isTeamClientError = Schema.is(TeamClient.TeamClientError);
const decodeSummaryJson = Schema.decodeUnknownEffect(Schema.fromJsonString(SummarySchema));
const encodeSummaryJson = Schema.encodeEffect(Schema.fromJsonString(SummarySchema));
const decodeTargetJson = Schema.decodeUnknownEffect(Schema.fromJsonString(TargetSchema));
const encodeTargetJson = Schema.encodeEffect(Schema.fromJsonString(TargetSchema));
const decodeCommittedJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DraftSchema.fields.committedAttachments),
);
const encodeCommittedJson = Schema.encodeEffect(
  Schema.fromJsonString(DraftSchema.fields.committedAttachments),
);
interface DraftRow {
  readonly host_id: string;
  readonly agent_id: string;
  readonly attachment_id: string;
  readonly summary_json: string;
  readonly sha256: string;
  readonly state: string;
  readonly send_text: string | null;
  readonly client_message_id: string;
  readonly first_attempt_at: string | null;
  readonly message_id: string | null;
  readonly target_json: string | null;
  readonly task_id: string | null;
  readonly conversation_message_id: string | null;
  readonly committed_json: string | null;
}
const draftFromRow = Effect.fn("OpenbotFiles.draftFromRow")((row: DraftRow) =>
  decodeSummaryJson(row.summary_json).pipe(
    Effect.flatMap((attachment) =>
      Effect.gen(function* () {
        const target = row.target_json === null ? null : yield* decodeTargetJson(row.target_json);
        const committedAttachments =
          row.committed_json === null ? null : yield* decodeCommittedJson(row.committed_json);
        return yield* decodeDraft({
          hostId: row.host_id,
          agentId: row.agent_id,
          attachment,
          sha256: row.sha256,
          state: row.state,
          sendText: row.send_text,
          messageId: row.message_id,
          conversationMessageId: row.conversation_message_id,
          committedAttachments,
          target,
          taskId: row.task_id,
        });
      }),
    ),
  ),
);
// Released Openbot user-send receipts expire after 24 hours; retain an hour's margin.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const make = Effect.gen(function* () {
  const integration = yield* Integration.Integration;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const gate = yield* Semaphore.make(1);
  const storageError = (operation: OpenbotFilesError["operation"]) => (cause: unknown) =>
    new OpenbotFilesError({ operation, reason: "storage", cause });
  const find = Effect.fn("OpenbotFiles.find")(function* (
    input: OpenbotFileDiscardInput,
    operation: OpenbotFilesError["operation"],
  ) {
    const rows =
      yield* sql<DraftRow>`SELECT * FROM openbot_file_drafts WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
        Effect.mapError(storageError(operation)),
      );
    if (!rows[0]) return yield* new OpenbotFilesError({ operation, reason: "ownership" });
    return rows[0];
  });
  const resolveCommitted = Effect.fn("OpenbotFiles.resolveCommitted")(function* (row: DraftRow) {
    if (row.conversation_message_id === null || row.committed_json !== null) return row;
    // Receipt persistence precedes this optional read. Visibility/read failure cannot undo acceptance.
    const attachments = yield* integration
      .withFilesToHost(row.host_id, (files) =>
        files.sentAttachments(row.agent_id, row.conversation_message_id!, row.task_id ?? undefined),
      )
      .pipe(
        Effect.timeout("10 seconds"),
        Effect.orElseSucceed(() => null),
      );
    if (attachments === null) return row;
    const committedJson = yield* encodeCommittedJson(attachments).pipe(
      Effect.mapError(storageError("send")),
    );
    yield* sql`UPDATE openbot_file_drafts SET committed_json = ${committedJson} WHERE host_id = ${row.host_id} AND agent_id = ${row.agent_id} AND attachment_id = ${row.attachment_id}`.pipe(
      Effect.mapError(storageError("send")),
    );
    return { ...row, committed_json: committedJson };
  });
  return Files.of({
    listWorkspace: Effect.fn("OpenbotFiles.listWorkspace")((input) =>
      integration
        .withFilesToHost(input.hostId, (files) => files.listWorkspace(input.agentId, input.path))
        .pipe(
          Effect.mapError(
            (cause) => new OpenbotFilesError({ operation: "list", reason: "transfer", cause }),
          ),
        ),
    ),
    search: Effect.fn("OpenbotFiles.search")(function* (input) {
      if ((input.agentId === undefined) !== (input.taskId === undefined))
        return yield* new OpenbotFilesError({ operation: "search", reason: "ownership" });
      return yield* integration
        .withFilesToHost(input.hostId, (files) =>
          files.search(
            input.query,
            input.cursor,
            input.agentId !== undefined && input.taskId !== undefined
              ? { agentId: input.agentId, taskId: input.taskId }
              : undefined,
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) => new OpenbotFilesError({ operation: "search", reason: "transfer", cause }),
          ),
        );
    }),
    materialize: Effect.fn("OpenbotFiles.materialize")(function* (input) {
      return yield* integration
        .withFilesToHost(input.hostId, (files) =>
          Effect.gen(function* () {
            const metadata =
              input.source.kind === "attachment"
                ? yield* files.attachment(input.agentId, input.source)
                : null;
            const name =
              metadata?.name ??
              (yield* Effect.try({
                try: () =>
                  decodeURIComponent(
                    path.basename(input.source.kind === "workspace" ? input.source.path : "file"),
                  ),
                catch: (cause) => new TeamClient.TeamClientError({ reason: "decode", cause }),
              }));
            const downloaded = yield* files.download(input.agentId, input.source);
            if (metadata && metadata.size !== downloaded.size)
              return yield* new TeamClient.TeamClientError({ reason: "decode" });
            const attachmentId = createPendingAttachmentId(attachmentFileExtension(name));
            const destination = resolveAttachmentRelativePath({
              attachmentsDir: config.attachmentsDir,
              relativePath: `${attachmentId}${attachmentFileExtension(name)}`,
            });
            if (destination === null)
              return yield* new TeamClient.TeamClientError({ reason: "decode" });
            const temporary = `${destination}.part`;
            const digest = NodeCrypto.createHash("sha256");
            let size = 0;
            return yield* Effect.gen(function* () {
              yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
              yield* Stream.run(
                downloaded.body.pipe(
                  Stream.tap((chunk) => {
                    size += chunk.byteLength;
                    if (size > downloaded.size || size > 104_857_600)
                      return Effect.fail(new TeamClient.TeamClientError({ reason: "decode" }));
                    digest.update(chunk);
                    return Effect.void;
                  }),
                ),
                fs.sink(temporary, { flag: "wx", mode: 0o600 }),
              );
              if (size !== downloaded.size)
                return yield* new TeamClient.TeamClientError({ reason: "decode" });
              const result = yield* decodeMaterialized({
                attachmentId,
                name,
                size,
                mimeType: metadata?.mimeType ?? downloaded.mimeType,
                sha256: digest.digest("hex"),
              });
              yield* fs.link(temporary, destination);
              return result;
            }).pipe(
              Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)),
              Effect.mapError((cause) =>
                isTeamClientError(cause)
                  ? cause
                  : new TeamClient.TeamClientError({ reason: "transport", cause }),
              ),
            );
          }),
        )
        .pipe(
          Effect.timeout("120 seconds"),
          Effect.mapError(
            (cause) => new OpenbotFilesError({ operation: "download", reason: "transfer", cause }),
          ),
        );
    }),
    uploadDraft: Effect.fn("OpenbotFiles.uploadDraft")(function* (input) {
      if (
        parseThreadSegmentFromAttachmentId(input.attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT
      )
        return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
      const source = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: input.attachmentId,
      });
      if (!source)
        return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
      const stat = yield* fs.stat(source).pipe(Effect.mapError(storageError("upload")));
      if (stat.type !== "File" || Number(stat.size) !== input.size || input.size > 104_857_600)
        return yield* new OpenbotFilesError({ operation: "upload", reason: "size" });
      const digest = NodeCrypto.createHash("sha256");
      let size = 0;
      const body = fs.stream(source).pipe(
        Stream.mapError((cause) => new TeamClient.TeamClientError({ reason: "transport", cause })),
        Stream.tap((chunk) => {
          size += chunk.byteLength;
          if (size > input.size)
            return Effect.fail(new TeamClient.TeamClientError({ reason: "decode" }));
          digest.update(chunk);
          return Effect.void;
        }),
      );
      return yield* integration
        .withFilesToHost(input.hostId, (files) =>
          Effect.gen(function* () {
            const attachment = yield* files.upload({
              agentId: input.agentId,
              name: input.name,
              mimeType: input.mimeType,
              size: input.size,
              body,
            });
            return yield* Effect.gen(function* () {
              if (size !== input.size || attachment.size !== size)
                return yield* new TeamClient.TeamClientError({ reason: "decode" });
              const sha256 = digest.digest("hex");
              const draft = yield* decodeDraft({
                ...input,
                attachment,
                sha256,
                state: "ready",
                sendText: null,
                messageId: null,
                conversationMessageId: null,
                committedAttachments: null,
                target: null,
                taskId: null,
              });
              const summaryJson = yield* encodeSummaryJson(attachment);
              yield* sql`INSERT INTO openbot_file_drafts (host_id, agent_id, attachment_id, summary_json, sha256, client_message_id) VALUES (${input.hostId}, ${input.agentId}, ${attachment.id}, ${summaryJson}, ${sha256}, ${NodeCrypto.randomUUID()})`;
              return draft;
            }).pipe(
              Effect.tapError(() => files.discard(attachment.id).pipe(Effect.ignore)),
              Effect.mapError((cause) =>
                isTeamClientError(cause)
                  ? cause
                  : new TeamClient.TeamClientError({ reason: "transport", cause }),
              ),
            );
          }),
        )
        .pipe(
          Effect.timeout("120 seconds"),
          Effect.mapError(
            (cause) => new OpenbotFilesError({ operation: "upload", reason: "transfer", cause }),
          ),
        );
    }),
    listDrafts: Effect.fn("OpenbotFiles.listDrafts")(
      function* (input) {
        const rows =
          yield* sql<DraftRow>`SELECT * FROM openbot_file_drafts WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} ORDER BY rowid DESC LIMIT 100`;
        return yield* Effect.forEach(rows, draftFromRow);
      },
      Effect.mapError(storageError("list")),
    ),
    sendDraft: Effect.fn("OpenbotFiles.sendDraft")(function* (input) {
      return yield* gate.withPermit(
        Effect.gen(function* () {
          const row = yield* find(input, "send");
          const target = input.target ?? { kind: "main" as const };
          const storedTarget =
            row.target_json === null
              ? null
              : yield* decodeTargetJson(row.target_json).pipe(
                  Effect.mapError(storageError("send")),
                );
          if (
            storedTarget !== null &&
            (storedTarget.kind !== target.kind ||
              (storedTarget.kind === "task" &&
                target.kind === "task" &&
                storedTarget.taskId !== target.taskId) ||
              (storedTarget.kind === "channel" &&
                target.kind === "channel" &&
                storedTarget.channelId !== target.channelId))
          )
            return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          if (row.send_text !== null && row.send_text !== input.text)
            return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          if (row.state === "sent") {
            const resolved = yield* resolveCommitted(row);
            return yield* draftFromRow(resolved).pipe(Effect.mapError(storageError("send")));
          }
          const now = yield* DateTime.now;
          if (
            row.state === "reconciliation-required" ||
            (row.first_attempt_at !== null &&
              DateTime.toEpochMillis(now) - Date.parse(row.first_attempt_at) >= RETRY_WINDOW_MS)
          ) {
            yield* sql`UPDATE openbot_file_drafts SET state = 'reconciliation-required' WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
              Effect.mapError(storageError("send")),
            );
            return yield* new OpenbotFilesError({
              operation: "send",
              reason: "reconciliation-required",
            });
          }
          const targetJson = yield* encodeTargetJson(target).pipe(
            Effect.mapError(storageError("send")),
          );
          yield* sql`UPDATE openbot_file_drafts SET state = 'sending', send_text = ${input.text}, target_json = ${targetJson}, first_attempt_at = COALESCE(first_attempt_at, ${DateTime.formatIso(now)}) WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
            Effect.mapError(storageError("send")),
          );
          const accepted = yield* integration
            .withFilesToHost(input.hostId, (files) =>
              files.send(
                input.agentId,
                input.attachmentId,
                input.text,
                row.client_message_id,
                target,
                row.state !== "ready",
              ),
            )
            .pipe(
              Effect.timeout("120 seconds"),
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  if (target.kind === "new-task")
                    yield* sql`UPDATE openbot_file_drafts SET state = 'reconciliation-required' WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
                      Effect.mapError(storageError("send")),
                    );
                  return yield* new OpenbotFilesError({
                    operation: "send",
                    reason: "transfer",
                    cause,
                  });
                }),
              ),
            );
          if (accepted === null) {
            yield* sql`UPDATE openbot_file_drafts SET state = 'reconciliation-required' WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
              Effect.mapError(storageError("send")),
            );
            return yield* new OpenbotFilesError({
              operation: "send",
              reason: "reconciliation-required",
            });
          }
          yield* sql`UPDATE openbot_file_drafts SET state = 'sent', message_id = ${accepted.messageId}, conversation_message_id = ${accepted.conversationMessageId}, task_id = ${accepted.taskId} WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
            Effect.mapError(storageError("send")),
          );
          const resolved = yield* resolveCommitted({
            ...row,
            state: "sent",
            send_text: input.text,
            message_id: accepted.messageId,
            conversation_message_id: accepted.conversationMessageId,
            target_json: targetJson,
            task_id: accepted.taskId,
          });
          return yield* draftFromRow(resolved).pipe(Effect.mapError(storageError("send")));
        }),
      );
    }),
    discardDraft: Effect.fn("OpenbotFiles.discardDraft")(function* (input) {
      yield* gate.withPermit(
        Effect.gen(function* () {
          const row = yield* find(input, "discard");
          if (row.state !== "ready")
            return yield* new OpenbotFilesError({ operation: "discard", reason: "conflict" });
          yield* integration
            .withFilesToHost(input.hostId, (files) => files.discard(input.attachmentId))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OpenbotFilesError({ operation: "discard", reason: "transfer", cause }),
              ),
            );
          yield* sql`DELETE FROM openbot_file_drafts WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
            Effect.mapError(storageError("discard")),
          );
        }),
      );
    }),
  });
});
export const layer = Layer.effect(Files, make);
