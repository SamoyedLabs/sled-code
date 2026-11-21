import { NewTaskStartJournal } from "./NewTaskStartJournal.ts";
import type { OpenbotNewTaskStartInput } from "@t3tools/contracts/openbot-instance-transfer";
import { InstanceTransferJournal } from "./InstanceTransferJournal.ts";
import type { OpenbotTransferCommand } from "@t3tools/contracts/openbot-instance-transfer";
import { editQueueAttachments } from "./QueueAttachmentsJournal.ts";
import type {
  QueueAttachmentTarget,
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
} from "../../../../packages/contracts/src/openbotQueueAttachments.ts";
import { OpenbotOriginalUploadIdentity } from "../../../../packages/contracts/src/openbotFiles.ts";
import { AuthSessionId } from "@t3tools/contracts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import * as Clock from "effect/Clock";
// @effect-diagnostics nodeBuiltinImport:off -- Stream hashing is the binary transport boundary.
import * as Option from "effect/Option";
import { type ImportRequest, type ImportReceipt } from "@t3tools/contracts/openbot-agent-import";
import type { OpenbotArchiveUploadInput } from "@t3tools/contracts";
import * as ArchiveUploads from "./ArchiveUploads.ts";
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
    readonly queueAttachmentContext: (
      principal: string,
      input: QueueAttachmentTarget,
    ) => Effect.Effect<
      { expectedRevision: string; text: string; keepAttachmentIds: readonly string[] },
      OpenbotFilesError
    >;
    readonly editQueueAttachments: (
      principal: string,
      input: QueueAttachmentEdit,
      resultOnly: boolean,
    ) => Effect.Effect<QueueAttachmentReceipt | null, OpenbotFilesError>;
    readonly fileContext: (
      principal: string,
      hostId: string,
    ) => Effect.Effect<{ hostId: string; principalId: string }, OpenbotFilesError>;
    readonly newTaskStart: (
      principal: string,
      input: typeof OpenbotNewTaskStartInput.Type,
    ) => Effect.Effect<Schema.Json, OpenbotFilesError>;
    readonly instanceTransfer: (
      principal: string,
      input: OpenbotTransferCommand,
    ) => Effect.Effect<Schema.Json, OpenbotFilesError>;
    readonly importContext: (
      principal: string,
      hostId: string,
    ) => Effect.Effect<
      { hostId: string; principalId: string; available: boolean },
      OpenbotFilesError
    >;
    readonly archiveUpload: (
      principal: string,
      input: OpenbotArchiveUploadInput,
    ) => Effect.Effect<{ uploadId: string; relativeUrl: string }, OpenbotFilesError>;
    readonly importExecute: (
      principal: string,
      input: ImportRequest,
    ) => Effect.Effect<ImportReceipt | null, OpenbotFilesError>;
    readonly listWorkspace: (
      input: OpenbotWorkspaceListInput,
    ) => Effect.Effect<OpenbotWorkspaceDirectory, OpenbotFilesError>;
    readonly search: (
      input: OpenbotConversationFileSearchInput,
    ) => Effect.Effect<OpenbotConversationFilePage, OpenbotFilesError>;
    readonly materialize: (
      input: OpenbotFileMaterializeInput,
    ) => Effect.Effect<OpenbotMaterializedFile, OpenbotFilesError>;
    readonly originalUpload: (
      principal: string,
      environmentId: string,
      input: OpenbotOriginalUploadIdentity & { attachmentId?: string },
      action: "upload" | "upload-status" | "upload-cancel",
    ) => Effect.Effect<
      { state: "absent" | "released" | "ready"; draft: OpenbotDraftFile | null },
      OpenbotFilesError
    >;
    readonly uploadDraft: (
      input: OpenbotFileUploadInput,
    ) => Effect.Effect<OpenbotDraftFile, OpenbotFilesError>;
    readonly listDrafts: (
      input: OpenbotFileScope,
      authority?: { principal: string; environmentId: string },
    ) => Effect.Effect<readonly OpenbotDraftFile[], OpenbotFilesError>;
    readonly sendDraft: (
      input: OpenbotFileSendInput,
      authority?: { principal: string; environmentId: string },
    ) => Effect.Effect<OpenbotDraftFile, OpenbotFilesError>;
    readonly discardDraft: (
      input: OpenbotFileDiscardInput,
      authority?: { principal: string; environmentId: string },
    ) => Effect.Effect<void, OpenbotFilesError>;
  }
>()("t3/openbot/Files") {}

const decodeMaterialized = Schema.decodeUnknownEffect(MaterializedSchema);
const decodeSessionId = Schema.decodeEffect(AuthSessionId);
const decodeUploadOwner = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ principal: Schema.String, environmentId: Schema.String })),
);
const encodeUploadOwner = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      principal: Schema.String,
      environmentId: Schema.String,
      ...OpenbotOriginalUploadIdentity.fields,
    }),
  ),
);
const decodeUploadIdentity = Schema.decodeEffect(
  Schema.fromJsonString(OpenbotOriginalUploadIdentity),
);

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
  readonly batch_json: string | null;
  readonly upload_json?: string | null;
}
const BatchSchema = Schema.Struct({
  expectedThreadId: Schema.optional(DraftSchema.fields.attachment.fields.id),
  attachmentIds: Schema.Array(DraftSchema.fields.attachment.fields.id).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  replyToMessageId: Schema.optional(DraftSchema.fields.attachment.fields.id),
});
const decodeBatchJson = Schema.decodeUnknownEffect(Schema.fromJsonString(BatchSchema));
const encodeBatchJson = Schema.encodeEffect(Schema.fromJsonString(BatchSchema));
const draftFromRow = Effect.fn("OpenbotFiles.draftFromRow")((row: DraftRow) =>
  decodeSummaryJson(row.summary_json).pipe(
    Effect.flatMap((attachment) =>
      Effect.gen(function* () {
        const target = row.target_json === null ? null : yield* decodeTargetJson(row.target_json);
        const committedAttachments =
          row.committed_json === null ? null : yield* decodeCommittedJson(row.committed_json);
        const batch = row.batch_json == null ? null : yield* decodeBatchJson(row.batch_json);
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
          ...(batch === null
            ? {}
            : {
                batchAttachmentIds: batch.attachmentIds,
                ...(batch.expectedThreadId === undefined
                  ? {}
                  : { expectedThreadId: batch.expectedThreadId }),
                ...(batch.replyToMessageId === undefined
                  ? {}
                  : { replyToMessageId: batch.replyToMessageId }),
              }),
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
  const archives = yield* Effect.serviceOption(ArchiveUploads.ArchiveUploads);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const gate = yield* Semaphore.make(1);
  const sessions = yield* Effect.serviceOption(AuthSessionRepository);
  const checkUploadPrincipal = Effect.fn("OpenbotFiles.checkUploadPrincipal")(
    function* (principal: string) {
      if (Option.isNone(sessions))
        return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
      const sessionId = yield* decodeSessionId(principal);
      const row = yield* sessions.value.getById({ sessionId });
      const now = yield* Clock.currentTimeMillis;
      if (
        Option.isNone(row) ||
        row.value.revokedAt !== null ||
        row.value.expiresAt.epochMilliseconds <= now
      )
        return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
    },
    Effect.mapError(
      (cause) => new OpenbotFilesError({ operation: "upload", reason: "ownership", cause }),
    ),
  );

  const storageError = (operation: OpenbotFilesError["operation"]) => (cause: unknown) =>
    new OpenbotFilesError({ operation, reason: "storage", cause });
  const find = Effect.fn("OpenbotFiles.find")(function* (
    input: OpenbotFileDiscardInput,
    operation: OpenbotFilesError["operation"],
    authority?: { principal: string; environmentId: string },
  ) {
    const rows =
      yield* sql<DraftRow>`SELECT * FROM openbot_file_drafts WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${input.attachmentId}`.pipe(
        Effect.mapError(storageError(operation)),
      );
    if (!rows[0]) return yield* new OpenbotFilesError({ operation, reason: "ownership" });
    if (rows[0].upload_json != null) {
      if (!authority) return yield* new OpenbotFilesError({ operation, reason: "ownership" });
      yield* checkUploadPrincipal(authority.principal);
      const owned = yield* decodeUploadOwner(rows[0].upload_json).pipe(
        Effect.mapError(storageError(operation)),
      );
      if (
        owned.principal !== authority.principal ||
        owned.environmentId !== authority.environmentId
      )
        return yield* new OpenbotFilesError({ operation, reason: "ownership" });
    }
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
  const transferJournal = new InstanceTransferJournal(
    path.join(config.stateDir, "openbot", "instance-transfer"),
  );
  const newTaskStarts = new NewTaskStartJournal(
    path.join(config.stateDir, "openbot", "new-task-starts"),
  );
  return Files.of({
    newTaskStart: Effect.fn("Files.newTaskStart")(function* (principal, input) {
      yield* checkUploadPrincipal(principal);
      const context = yield* Effect.context<never>();
      return yield* Effect.tryPromise({
        try: () =>
          newTaskStarts.run(principal, input, () =>
            Effect.runPromiseWith(context)(
              integration.apiWriteToHost(input.hostId, {
                operation: "task.start",
                agentId: input.agentId,
                clientMessageId: input.clientMessageId,
                text: input.text,
              }),
            ),
          ),
        catch: storageError("send"),
      });
    }),
    instanceTransfer: Effect.fn("Files.instanceTransfer")(function* (principal, input) {
      if (Option.isNone(archives))
        return yield* new OpenbotFilesError({ operation: "upload", reason: "storage" });
      yield* archives.value.checkPrincipal(principal);
      const archiveService = archives.value;
      const effectContext = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(effectContext);
      const recoverOwner = (owner: string) =>
        runPromise(archiveService.canRecoverTransfer(principal, owner));
      const releaseFinalized = Effect.fn("Files.releaseFinalizedTransferUpload")(function* (
        requestId: string,
      ) {
        const uploadId = yield* Effect.tryPromise({
          try: () =>
            transferJournal.finalizedUpload(principal, input.hostId, requestId, recoverOwner),
          catch: storageError("discard"),
        });
        if (uploadId)
          yield* archiveService.releaseTransfer(
            principal,
            uploadId.principal,
            input.hostId,
            uploadId.uploadId,
          );
      });
      const run = <A>(
        action: (
          transfer: NonNullable<TeamClient.Session["instanceTransfer"]>,
        ) => Effect.Effect<A, TeamClient.TeamClientError>,
      ) => integration.withInstanceTransferToHost(input.hostId, action);
      if (input.operation === "upload")
        return yield* archives.value.issue(principal, {
          hostId: input.hostId,
          principalId: principal,
          name: input.name,
          size: input.size,
        });
      if (input.operation === "summary")
        return yield* run((transfer) => transfer.summary).pipe(
          Effect.mapError(storageError("list")),
        );
      if (input.operation === "recover") {
        const receipt = yield* Effect.tryPromise({
          try: () =>
            transferJournal.recover(principal, input.hostId, input.requestId, recoverOwner),
          catch: storageError("list"),
        });
        yield* releaseFinalized(input.requestId);
        return receipt;
      }
      if (input.operation === "pending")
        return yield* Effect.tryPromise({
          try: () => transferJournal.pending(principal, input.hostId, recoverOwner),
          catch: storageError("list"),
        });
      if (input.operation === "stage") {
        const previous = yield* Effect.tryPromise({
          try: () =>
            transferJournal.stageReceipt(
              principal,
              input.hostId,
              input.requestId,
              input.uploadId,
              recoverOwner,
            ),
          catch: storageError("upload"),
        });
        if (previous) {
          yield* releaseFinalized(input.requestId);
          return previous;
        }
        const uploaded = yield* archives.value.read(principal, input.hostId, input.uploadId);
        return yield* Effect.tryPromise({
          try: () =>
            transferJournal.stage(
              principal,
              input.hostId,
              input.requestId,
              uploaded.sha256,
              () => runPromise(run((transfer) => transfer.stage(uploaded.bytes))),
              input.uploadId,
            ),
          catch: storageError("upload"),
        });
      }
      if (input.operation === "apply") {
        const receipt = yield* Effect.tryPromise({
          try: () =>
            transferJournal.apply(
              principal,
              input.hostId,
              input.token,
              {
                keys: input.keys,
                includeSettings: input.includeSettings,
                timezone: input.timezone,
              },
              (token) =>
                runPromise(
                  run((transfer) =>
                    transfer.apply({
                      token,
                      keys: input.keys,
                      includeSettings: input.includeSettings,
                      timezone: input.timezone,
                    }),
                  ),
                ),
              recoverOwner,
            ),
          catch: storageError("send"),
        });
        yield* releaseFinalized(input.token);
        return receipt;
      }
      if (input.operation === "discard") {
        const receipt = yield* Effect.tryPromise({
          try: () =>
            transferJournal.discard(
              principal,
              input.hostId,
              input.token,
              (token) => runPromise(run((transfer) => transfer.discard(token))),
              recoverOwner,
            ),
          catch: storageError("discard"),
        });
        yield* releaseFinalized(input.token);
        return receipt;
      }
      return yield* run((transfer) =>
        Effect.gen(function* () {
          const downloaded = yield* transfer.exportZip(input);
          const name = "openbot-transfer.zip",
            attachmentId = createPendingAttachmentId(".zip");
          const destination = resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}.zip`,
          });
          if (destination === null)
            return yield* new TeamClient.TeamClientError({ reason: "decode" });
          const temporary = `${destination}.part`,
            digest = NodeCrypto.createHash("sha256");
          let size = 0;
          return yield* Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
            yield* Stream.run(
              downloaded.body.pipe(
                Stream.tap((chunk) => {
                  size += chunk.byteLength;
                  if (size > downloaded.size || size > 104857600)
                    return Effect.fail(new TeamClient.TeamClientError({ reason: "decode" }));
                  digest.update(chunk);
                  return Effect.void;
                }),
              ),
              fs.sink(temporary, { flag: "wx", mode: 0o600 }),
            );
            if (size !== downloaded.size)
              return yield* new TeamClient.TeamClientError({ reason: "decode" });
            const file = yield* decodeMaterialized({
              attachmentId,
              name,
              size,
              mimeType: "application/zip",
              sha256: digest.digest("hex"),
            });
            yield* fs.link(temporary, destination);
            return { file };
          }).pipe(
            Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)),
            Effect.mapError(
              (cause) => new TeamClient.TeamClientError({ reason: "transport", cause }),
            ),
          );
        }),
      ).pipe(Effect.mapError(storageError("download")));
    }),
    fileContext: Effect.fn("Files.fileContext")(function* (principal, hostId) {
      yield* checkUploadPrincipal(principal);
      return yield* integration
        .withFilesToHost(hostId, () => Effect.succeed({ hostId, principalId: principal }))
        .pipe(Effect.mapError(storageError("list")));
    }),
    importContext: Effect.fn("Files.importContext")((principal, hostId) =>
      integration
        .withImportToHost(hostId, (imports) => imports.available)
        .pipe(
          Effect.map((available) => ({ hostId, principalId: principal, available })),
          Effect.mapError(storageError("list")),
        ),
    ),
    archiveUpload: Effect.fn("Files.archiveUpload")((principal, input) =>
      Option.isSome(archives)
        ? integration
            .withImportToHost(input.hostId, (imports) => imports.available)
            .pipe(
              Effect.flatMap((available) =>
                available
                  ? archives.value.issue(principal, input)
                  : Effect.fail(new OpenbotFilesError({ operation: "upload", reason: "transfer" })),
              ),
              Effect.mapError(storageError("upload")),
            )
        : Effect.fail(new OpenbotFilesError({ operation: "upload", reason: "storage" })),
    ),
    importExecute: Effect.fn("OpenbotFiles.importExecute")(function* (principal, input) {
      if (Option.isNone(archives))
        return yield* new OpenbotFilesError({ operation: "upload", reason: "storage" });
      const uploaded =
        input.operation === "import.stage"
          ? yield* archives.value.read(principal, input.hostId, input.uploadId)
          : undefined;
      yield* archives.value.checkPrincipal(principal);
      return yield* integration
        .withImportToHost(input.hostId, (imports) =>
          imports.execute(principal, input, uploaded?.bytes),
        )
        .pipe(Effect.mapError(storageError("upload")));
    }),
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
      const agentId = "agentId" in input ? input.agentId : null;
      return yield* integration
        .withFilesToHost(input.hostId, (files) =>
          Effect.gen(function* () {
            const metadata =
              input.source.kind === "attachment" ||
              input.source.kind === "stored" ||
              input.source.kind === "library"
                ? yield* files.attachment(agentId, input.source)
                : null;
            const name =
              metadata?.name ??
              (yield* Effect.try({
                try: () =>
                  decodeURIComponent(
                    path.basename(
                      input.source.kind === "workspace" || input.source.kind === "shared"
                        ? input.source.path
                        : input.source.kind === "local-skill"
                          ? `${input.source.skillId}-${input.source.revision}.zip`
                          : "file",
                    ),
                  ),
                catch: (cause) => new TeamClient.TeamClientError({ reason: "decode", cause }),
              }));
            const downloaded = yield* files.download(agentId, input.source);
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
    queueAttachmentContext: Effect.fn("Files.queueAttachmentContext")(function* (principal, input) {
      yield* checkUploadPrincipal(principal);
      return yield* integration
        .withFilesToHost(input.hostId, (files) =>
          files.queueAttachmentContext
            ? files.queueAttachmentContext(principal, input)
            : Effect.fail(new TeamClient.TeamClientError({ reason: "decode" })),
        )
        .pipe(Effect.mapError(storageError("send")));
    }),
    editQueueAttachments: Effect.fn("Files.editQueueAttachments")(
      function* (principal, input, resultOnly) {
        return yield* gate
          .withPermit(
            editQueueAttachments(sql, input, principal, resultOnly, {
              authorize: () => checkUploadPrincipal(principal),
              post: (lookup) =>
                integration
                  .withFilesToHost(input.hostId, (files) =>
                    files.queueAttachments
                      ? files.queueAttachments(principal, input, lookup)
                      : Effect.fail(new TeamClient.TeamClientError({ reason: "decode" })),
                  )
                  .pipe(Effect.mapError(storageError("send"))),
            }),
          )
          .pipe(Effect.mapError(storageError("send")));
      },
    ),
    originalUpload: Effect.fn("OpenbotFiles.originalUpload")(
      function* (principal, environmentId, input, action) {
        return yield* gate
          .withPermit(
            Effect.gen(function* () {
              yield* checkUploadPrincipal(principal);
              if (
                input.channelId !== undefined &&
                (input.channelId !== input.threadId || input.taskId !== null)
              ) {
                return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
              }
              const identity: OpenbotOriginalUploadIdentity = {
                operationId: input.operationId,
                hostId: input.hostId,
                agentId: input.agentId,
                threadId: input.threadId,
                taskId: input.taskId,
                ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
                name: input.name,
                mimeType: input.mimeType,
                size: input.size,
                sha256: input.sha256,
              };
              const ownership = yield* encodeUploadOwner({ principal, environmentId, ...identity });
              const rows = yield* sql<
                DraftRow & { upload_json: string }
              >`SELECT * FROM openbot_file_drafts WHERE json_extract(upload_json, '$.operationId') = ${input.operationId}`;
              const original = rows[0];
              if (original && original.upload_json !== ownership)
                return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
              if (
                action === "upload-cancel" &&
                original &&
                (original.state === "sending" || original.state === "sent")
              )
                return yield* new OpenbotFilesError({ operation: "upload", reason: "conflict" });
              let bytes: Uint8Array | undefined;
              if (action === "upload") {
                if (
                  !input.attachmentId ||
                  parseThreadSegmentFromAttachmentId(input.attachmentId) !==
                    PENDING_ATTACHMENT_THREAD_SEGMENT
                )
                  return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
                const source = resolveAttachmentPathById({
                  attachmentsDir: config.attachmentsDir,
                  attachmentId: input.attachmentId,
                });
                if (!source)
                  return yield* new OpenbotFilesError({ operation: "upload", reason: "ownership" });
                const stat = yield* fs.stat(source);
                if (
                  stat.type !== "File" ||
                  Number(stat.size) !== input.size ||
                  input.size > 104857600
                )
                  return yield* new OpenbotFilesError({ operation: "upload", reason: "size" });
                bytes = yield* fs.readFile(source);
                if (
                  bytes.length !== input.size ||
                  NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== input.sha256
                )
                  return yield* new OpenbotFilesError({ operation: "upload", reason: "conflict" });
                if (!original) {
                  const summary = yield* encodeSummaryJson({
                    id: input.operationId,
                    name: input.name,
                    size: input.size,
                    mimeType: input.mimeType,
                    kind: "file",
                    previewKind: "none",
                  });
                  yield* sql`INSERT INTO openbot_file_drafts (host_id, agent_id, attachment_id, summary_json, sha256, client_message_id, state, upload_json) VALUES (${input.hostId}, ${input.agentId}, ${"upload:" + input.operationId}, ${summary}, ${input.sha256}, ${NodeCrypto.randomUUID()}, 'reconciliation-required', ${ownership})`;
                }
              } else if (!original) {
                if (action === "upload-status") return { state: "absent" as const, draft: null };
                const summary = yield* encodeSummaryJson({
                  id: input.operationId,
                  name: input.name,
                  size: input.size,
                  mimeType: input.mimeType,
                  kind: "file",
                  previewKind: "none",
                });
                yield* sql`INSERT INTO openbot_file_drafts (host_id, agent_id, attachment_id, summary_json, sha256, client_message_id, state, upload_json) VALUES (${input.hostId}, ${input.agentId}, ${"upload:" + input.operationId}, ${summary}, ${input.sha256}, ${NodeCrypto.randomUUID()}, 'reconciliation-required', ${ownership})`;
              }
              yield* checkUploadPrincipal(principal);
              const receipt = yield* integration.withFilesToHost(input.hostId, (files) =>
                files.originalUpload
                  ? files.originalUpload(
                      principal,
                      environmentId,
                      identity,
                      action,
                      bytes === undefined ? undefined : Buffer.from(bytes).toString("base64"),
                    )
                  : Effect.fail(new TeamClient.TeamClientError({ reason: "decode" })),
              );
              yield* checkUploadPrincipal(principal);
              if (receipt === null) return { state: "absent" as const, draft: null };
              if (
                receipt.attachment.size !== input.size ||
                receipt.attachment.name !== input.name ||
                receipt.attachment.mimeType !== input.mimeType
              )
                return yield* new OpenbotFilesError({ operation: "upload", reason: "conflict" });
              if (
                original &&
                original.attachment_id !== "upload:" + input.operationId &&
                original.attachment_id !== receipt.attachment.id
              )
                return yield* new OpenbotFilesError({ operation: "upload", reason: "conflict" });
              if (receipt.state === "released") {
                // An already committed send consumes its draft. Return the exact persisted batch
                // to its owner so the normal receipt-only send path can reconcile a lost reply.
                if (
                  action === "upload-status" &&
                  original?.attachment_id === receipt.attachment.id &&
                  (original.state === "sending" || original.state === "sent")
                ) {
                  return { state: "ready" as const, draft: yield* draftFromRow(original) };
                }
                yield* sql`UPDATE openbot_file_drafts SET state = 'reconciliation-required' WHERE upload_json = ${ownership} AND state NOT IN ('sending', 'sent')`;
                return { state: "released" as const, draft: null };
              }
              const summary = yield* encodeSummaryJson(receipt.attachment);
              yield* sql`UPDATE openbot_file_drafts SET attachment_id = ${receipt.attachment.id}, summary_json = ${summary}, state = CASE WHEN state = 'reconciliation-required' THEN 'ready' ELSE state END WHERE upload_json = ${ownership}`;
              const ready =
                yield* sql<DraftRow>`SELECT * FROM openbot_file_drafts WHERE upload_json = ${ownership}`;
              return { state: "ready" as const, draft: yield* draftFromRow(ready[0]!) };
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new OpenbotFilesError({ operation: "upload", reason: "transfer", cause }),
            ),
          );
      },
    ),
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
      function* (input, authority) {
        if (authority) yield* checkUploadPrincipal(authority.principal);
        const rows =
          yield* sql<DraftRow>`SELECT * FROM openbot_file_drafts WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND (upload_json IS NULL OR (json_extract(upload_json, '$.principal') = ${authority?.principal ?? null} AND json_extract(upload_json, '$.environmentId') = ${authority?.environmentId ?? null} AND attachment_id NOT LIKE 'upload:%' AND state != 'reconciliation-required')) ORDER BY rowid DESC LIMIT 100`;
        const drafts = yield* Effect.forEach(rows, draftFromRow);
        if (authority) yield* checkUploadPrincipal(authority.principal);
        return drafts;
      },
      Effect.mapError(storageError("list")),
    ),
    sendDraft: Effect.fn("OpenbotFiles.sendDraft")(function* (input, authority) {
      return yield* gate.withPermit(
        Effect.gen(function* () {
          const attachmentIds = input.attachmentIds ?? [input.attachmentId];
          if (
            attachmentIds[0] !== input.attachmentId ||
            new Set(attachmentIds).size !== attachmentIds.length ||
            attachmentIds.length === 0 ||
            attachmentIds.length > 10
          )
            return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          const target = input.target ?? { kind: "main" as const };
          if (input.expectedThreadId !== undefined && target.kind === "new-task")
            return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          if (target.kind === "new-task" && input.replyToMessageId !== undefined)
            return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          const targetJson = yield* encodeTargetJson(target).pipe(
            Effect.mapError(storageError("send")),
          );
          const batchJson = yield* encodeBatchJson({
            attachmentIds,
            ...(input.expectedThreadId === undefined
              ? {}
              : { expectedThreadId: input.expectedThreadId }),
            ...(input.replyToMessageId === undefined
              ? {}
              : { replyToMessageId: input.replyToMessageId }),
          }).pipe(Effect.mapError(storageError("send")));
          const rows = yield* Effect.forEach(attachmentIds, (attachmentId) =>
            find({ ...input, attachmentId }, "send", authority),
          );
          const row = rows[0];
          if (!row) return yield* new OpenbotFilesError({ operation: "send", reason: "ownership" });
          for (const member of rows) {
            if (member.upload_json != null) {
              const owned = yield* decodeUploadIdentity(member.upload_json).pipe(
                Effect.mapError(storageError("send")),
              );
              if (
                input.expectedThreadId !== owned.threadId ||
                target.kind === "new-task" ||
                owned.channelId !== (target.kind === "channel" ? target.channelId : undefined) ||
                owned.taskId !== (target.kind === "task" ? target.taskId : null)
              )
                return yield* new OpenbotFilesError({ operation: "send", reason: "ownership" });
            } else if (target.kind === "channel" && input.expectedThreadId !== undefined) {
              return yield* new OpenbotFilesError({ operation: "send", reason: "ownership" });
            }
            if (
              (member.batch_json != null && member.batch_json !== batchJson) ||
              (member.batch_json == null &&
                member.state !== "ready" &&
                (attachmentIds.length !== 1 || input.replyToMessageId !== undefined)) ||
              (member.send_text !== null && member.send_text !== input.text) ||
              (member.target_json !== null && member.target_json !== targetJson) ||
              (member.state !== "ready" && member.client_message_id !== row.client_message_id)
            )
              return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
          }
          if (rows.some((member) => member.state === "sent")) {
            if (!rows.every((member) => member.state === "sent"))
              return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
            if (input.expectedThreadId !== undefined) {
              const replay = yield* integration
                .withFilesToHost(input.hostId, (files) =>
                  files.send(
                    input.agentId,
                    input.attachmentId,
                    input.text,
                    row.client_message_id,
                    target,
                    true,
                    attachmentIds,
                    input.replyToMessageId,
                    input.expectedThreadId,
                    authority ? { ...authority, hostId: input.hostId } : undefined,
                  ),
                )
                .pipe(Effect.mapError(storageError("send")));
              if (!replay || replay.messageId !== row.message_id || replay.taskId !== row.task_id)
                return yield* new OpenbotFilesError({ operation: "send", reason: "conflict" });
            }
            if (authority) yield* checkUploadPrincipal(authority.principal);
            return yield* draftFromRow(yield* resolveCommitted(row)).pipe(
              Effect.mapError(storageError("send")),
            );
          }
          const updateAll = (
            state: "sending" | "reconciliation-required",
            firstAttemptAt?: string,
          ) =>
            sql
              .withTransaction(
                Effect.forEach(
                  rows,
                  (member) =>
                    sql`UPDATE openbot_file_drafts SET state = ${state}, send_text = ${input.text}, target_json = ${targetJson}, batch_json = ${batchJson}, client_message_id = ${row.client_message_id}, first_attempt_at = COALESCE(first_attempt_at, ${firstAttemptAt ?? row.first_attempt_at}) WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${member.attachment_id}`,
                ),
              )
              .pipe(Effect.mapError(storageError("send")));
          const now = yield* DateTime.now;
          if (
            rows.some(
              (member) =>
                member.state === "reconciliation-required" ||
                (member.first_attempt_at !== null &&
                  DateTime.toEpochMillis(now) - Date.parse(member.first_attempt_at) >=
                    RETRY_WINDOW_MS),
            )
          ) {
            yield* updateAll("reconciliation-required");
            return yield* new OpenbotFilesError({
              operation: "send",
              reason: "reconciliation-required",
            });
          }
          yield* updateAll("sending", DateTime.formatIso(now));
          if (authority) yield* checkUploadPrincipal(authority.principal);
          const accepted = yield* integration
            .withFilesToHost(input.hostId, (files) =>
              files.send(
                input.agentId,
                input.attachmentId,
                input.text,
                row.client_message_id,
                target,
                row.state !== "ready",
                attachmentIds,
                input.replyToMessageId,
                input.expectedThreadId,
                authority ? { ...authority, hostId: input.hostId } : undefined,
              ),
            )
            .pipe(
              Effect.timeout("120 seconds"),
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  if (target.kind === "new-task") yield* updateAll("reconciliation-required");
                  return yield* new OpenbotFilesError({
                    operation: "send",
                    reason: "transfer",
                    cause,
                  });
                }),
              ),
            );
          if (accepted === null) {
            yield* updateAll("reconciliation-required");
            return yield* new OpenbotFilesError({
              operation: "send",
              reason: "reconciliation-required",
            });
          }
          yield* sql
            .withTransaction(
              Effect.forEach(
                rows,
                (member) =>
                  sql`UPDATE openbot_file_drafts SET state = 'sent', message_id = ${accepted.messageId}, conversation_message_id = ${accepted.conversationMessageId}, task_id = ${accepted.taskId} WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND attachment_id = ${member.attachment_id}`,
              ),
            )
            .pipe(Effect.mapError(storageError("send")));
          const resolved = yield* resolveCommitted({
            ...row,
            state: "sent",
            send_text: input.text,
            batch_json: batchJson,
            message_id: accepted.messageId,
            conversation_message_id: accepted.conversationMessageId,
            target_json: targetJson,
            task_id: accepted.taskId,
          });
          if (authority) yield* checkUploadPrincipal(authority.principal);
          return yield* draftFromRow(resolved).pipe(Effect.mapError(storageError("send")));
        }),
      );
    }),
    discardDraft: Effect.fn("OpenbotFiles.discardDraft")(function* (input, authority) {
      yield* gate.withPermit(
        Effect.gen(function* () {
          const row = yield* find(input, "discard", authority);
          if (row.upload_json != null) {
            const identity = yield* decodeUploadIdentity(row.upload_json).pipe(
              Effect.mapError(storageError("discard")),
            );
            if (row.state !== "ready" || !authority)
              return yield* new OpenbotFilesError({ operation: "discard", reason: "conflict" });
            const receipt = yield* integration
              .withFilesToHost(input.hostId, (files) =>
                files.originalUpload
                  ? files.originalUpload(
                      authority.principal,
                      authority.environmentId,
                      identity,
                      "upload-cancel",
                    )
                  : Effect.fail(new TeamClient.TeamClientError({ reason: "decode" })),
              )
              .pipe(Effect.mapError(storageError("discard")));
            yield* checkUploadPrincipal(authority.principal);
            if (receipt?.state !== "released")
              return yield* new OpenbotFilesError({
                operation: "discard",
                reason: "reconciliation-required",
              });
            yield* sql`UPDATE openbot_file_drafts SET state = 'reconciliation-required' WHERE upload_json = ${row.upload_json}`.pipe(
              Effect.mapError(storageError("discard")),
            );
            return;
          }
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
