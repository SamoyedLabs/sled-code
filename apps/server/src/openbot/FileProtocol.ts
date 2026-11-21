import * as QueueAttachmentsProtocol from "./QueueAttachmentsProtocol.ts";
import type {
  QueueAttachmentTarget,
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
} from "../../../../packages/contracts/src/openbotQueueAttachments.ts";
import {
  OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
  OpenbotOriginalUploadIdentity,
} from "../../../../packages/contracts/src/openbotFiles.ts";
import {
  OpenbotChannel,
  OpenbotChannelPage,
  OpenbotFileSummary,
  OpenbotWorkspaceDirectory,
  OpenbotConversationFilePage,
  OpenbotFileScope,
  type OpenbotFileTarget,
  type OpenbotFileMaterializeInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

const decodeQueueCapabilities = Schema.decodeUnknownOption(
  Schema.Struct({ capabilities: Schema.Array(Schema.String) }),
);
type Summary = OpenbotFileSummary;
type Source = OpenbotFileMaterializeInput["source"];
export interface FileSession<E> {
  readonly queueAttachmentContext?: (
    principal: string,
    input: QueueAttachmentTarget,
  ) => Effect.Effect<
    { expectedRevision: string; text: string; keepAttachmentIds: readonly string[] },
    E
  >;
  readonly queueAttachments?: (
    principal: string,
    input: QueueAttachmentEdit,
    resultOnly: boolean,
  ) => Effect.Effect<QueueAttachmentReceipt | null, E>;
  readonly originalUpload?: (
    principal: string,
    environmentId: string,
    identity: OpenbotOriginalUploadIdentity,
    action: "upload" | "upload-status" | "upload-cancel",
    dataBase64?: string,
  ) => Effect.Effect<{ state: "ready" | "released"; attachment: Summary } | null, E>;

  readonly listWorkspace: (
    agentId: string,
    path: string,
  ) => Effect.Effect<OpenbotWorkspaceDirectory, E>;
  readonly search: (
    query: string,
    cursor?: string,
    task?: { readonly agentId: string; readonly taskId: string },
  ) => Effect.Effect<OpenbotConversationFilePage, E>;
  readonly attachment: (
    agentId: string | null,
    source: Extract<Source, { kind: "attachment" | "stored" | "library" }>,
  ) => Effect.Effect<Summary, E>;
  readonly sentAttachments: (
    agentId: string,
    conversationMessageId: string,
    taskId?: string,
  ) => Effect.Effect<readonly Summary[], E>;
  readonly download: (
    agentId: string | null,
    source: Source,
  ) => Effect.Effect<
    {
      readonly body: Stream.Stream<Uint8Array, E>;
      readonly size: number;
      readonly mimeType: string;
    },
    E
  >;
  readonly upload: (input: {
    readonly agentId: string;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    readonly body: Stream.Stream<Uint8Array, E>;
  }) => Effect.Effect<Summary, E>;
  readonly send: (
    agentId: string,
    attachmentId: string,
    text: string,
    clientMessageId: string,
    target: OpenbotFileTarget,
    reconcile: boolean,
    attachmentIds?: readonly string[],
    replyToMessageId?: string,
    expectedThreadId?: string,
    authority?: { principal: string; environmentId: string; hostId: string },
  ) => Effect.Effect<
    {
      readonly messageId: string | null;
      readonly conversationMessageId: string | null;
      readonly taskId: string | null;
    } | null,
    E
  >;
  readonly discard: (attachmentId: string) => Effect.Effect<void, E>;
}
const Conversation = Schema.Struct({
  agentId: OpenbotFileScope.fields.agentId,
  threadId: Schema.NullOr(OpenbotFileScope.fields.agentId),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      createdAt: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
      attachments: Schema.optional(Schema.Array(OpenbotFileSummary)),
    }),
  ),
});
const Sent = Schema.Struct({
  messageId: OpenbotFileScope.fields.agentId,
  deliveries: Schema.Array(
    Schema.Struct({
      id: OpenbotFileScope.fields.agentId,
      recipientAgentId: OpenbotFileScope.fields.agentId,
    }),
  ).check(Schema.isMaxLength(100)),
});
const decodeChannel = Schema.decodeUnknownEffect(OpenbotChannel);
const decodeChannelPage = Schema.decodeUnknownEffect(OpenbotChannelPage);
const decodeWorkspace = Schema.decodeUnknownEffect(OpenbotWorkspaceDirectory);
const decodeSearch = Schema.decodeUnknownEffect(OpenbotConversationFilePage);
const decodeAttachment = Schema.decodeUnknownEffect(OpenbotFileSummary);
const decodeOriginalUploadReceipt = Schema.decodeUnknownEffect(
  Schema.NullOr(
    Schema.Struct({
      state: Schema.Literals(["ready", "released"]),
      attachment: OpenbotFileSummary,
    }),
  ),
);
const decodeGroupFileReceipt = Schema.decodeUnknownEffect(
  Schema.Struct({
    channelId: OpenbotFileScope.fields.agentId,
    messageId: OpenbotFileScope.fields.agentId,
    receiptId: OpenbotFileScope.fields.agentId,
  }),
);
const decodeConversation = Schema.decodeUnknownEffect(Conversation);
const decodeSent = Schema.decodeUnknownEffect(Sent);
const decodeAgentIds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: OpenbotFileScope.fields.agentId })).check(
    Schema.isMaxLength(10_000),
  ),
);
const Task = Schema.Struct({
  id: OpenbotFileScope.fields.agentId,
  agentId: OpenbotFileScope.fields.agentId,
  threadId: OpenbotFileScope.fields.agentId,
});
const decodeTask = Schema.decodeUnknownEffect(Task);
const decodeTasks = Schema.decodeUnknownEffect(
  Schema.Struct({
    agentId: OpenbotFileScope.fields.agentId,
    tasks: Schema.Array(Task).check(Schema.isMaxLength(50)),
  }),
);
const projectAttachment = (value: Summary): Summary => ({
  id: value.id,
  name: value.name,
  size: value.size,
  kind: value.kind,
  mimeType: value.mimeType,
  previewKind: value.previewKind,
});

export function createFileSession<E>(transport: {
  readonly signedQueueAttachments?: (
    principal: string,
    path: string,
    body: string,
  ) => Effect.Effect<unknown, E>;
  readonly signedFiles?: (
    principal: string,
    path:
      | "/v1/sled/files/upload"
      | "/v1/sled/files/upload-status"
      | "/v1/sled/files/upload-cancel"
      | "/v1/sled/files/send"
      | "/v1/sled/files/channel-send",
    body: Schema.Json,
  ) => Effect.Effect<Schema.Json, E>;

  readonly authenticated: (
    path: string,
    method: "GET" | "POST" | "DELETE",
  ) => HttpClientRequest.HttpClientRequest;
  readonly send: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, E>;
  readonly json: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<Schema.Json, E>;
  readonly error: (reason: "transport" | "decode" | "closed", cause?: unknown) => E;
  readonly isError: (value: unknown) => value is E;
  readonly isClosed: () => boolean;
}): FileSession<E> {
  const get = Effect.fn("OpenbotFiles.protocol.get")(function* (path: string) {
    if (transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
    return yield* transport.send(transport.authenticated(path, "GET"));
  });
  const post = Effect.fn("OpenbotFiles.protocol.post")(function* (path: string, body: Schema.Json) {
    if (transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
    const request = yield* HttpClientRequest.bodyJson(body)(
      transport.authenticated(path, "POST"),
    ).pipe(Effect.mapError((cause) => transport.error("decode", cause)));
    return yield* transport.send(request).pipe(Effect.flatMap(transport.json));
  });
  const listTasks = Effect.fn("OpenbotFiles.protocol.listTasks")(function* (agentId: string) {
    const data = yield* post("/v1/agent-tasks/list", { agentId }).pipe(
      Effect.flatMap(decodeTasks),
      Effect.mapError((cause) =>
        transport.isError(cause) ? cause : transport.error("decode", cause),
      ),
    );
    if (data.agentId !== agentId || data.tasks.some((task) => task.agentId !== agentId))
      return yield* Effect.fail(transport.error("decode"));
    return data.tasks;
  });
  const readTask = Effect.fn("OpenbotFiles.protocol.readTask")(function* (
    agentId: string,
    task: typeof Task.Type,
  ) {
    const data = yield* post("/v1/agent-tasks/read", { agentId, taskId: task.id }).pipe(
      Effect.flatMap(decodeConversation),
      Effect.mapError((cause) =>
        transport.isError(cause) ? cause : transport.error("decode", cause),
      ),
    );
    if (data.agentId !== agentId || data.threadId !== task.threadId)
      return yield* Effect.fail(transport.error("decode"));
    return data;
  });
  const findTask = Effect.fn("OpenbotFiles.protocol.findTask")(function* (
    agentId: string,
    taskId: string,
  ) {
    const task = (yield* listTasks(agentId)).find((task) => task.id === taskId);
    if (!task) return yield* Effect.fail(transport.error("decode"));
    return task;
  });
  const conversationMessage = Effect.fn("OpenbotFiles.protocol.conversationMessage")(function* (
    agentId: string,
    messageId: string,
    taskId?: string,
  ) {
    const data = yield* (
      taskId === undefined
        ? get(
            `/v1/agents/${encodeURIComponent(agentId)}/conversation-page?${new URLSearchParams({ around: messageId, limit: "100" })}`,
          ).pipe(Effect.flatMap(transport.json), Effect.flatMap(decodeConversation))
        : readTask(agentId, yield* findTask(agentId, taskId))
    ).pipe(
      Effect.mapError((cause) =>
        transport.isError(cause) ? cause : transport.error("decode", cause),
      ),
    );
    if (data.agentId !== agentId) return yield* Effect.fail(transport.error("decode"));
    const message = data.messages.find((message) => message.id === messageId);
    if (!message) return yield* Effect.fail(transport.error("decode"));
    return message;
  });
  const storedAttachment = Effect.fn("OpenbotFiles.protocol.storedAttachment")(function* (
    agentId: string | null,
    source: Extract<Source, { kind: "stored" | "library" }>,
  ) {
    if (source.kind === "stored" && !agentId) return yield* Effect.fail(transport.error("decode"));
    const scope = source.kind === "library" ? "host" : "agent";
    const scopedAgentId = scope === "agent" ? agentId : null;
    const data = yield* post("/v1/storage/usage", {
      scope,
      ...(scopedAgentId === null ? {} : { agentId: scopedAgentId }),
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            scope: Schema.Literals(["agent", "host"]),
            agentId: Schema.NullOr(OpenbotFileScope.fields.agentId),
            files: Schema.Array(
              Schema.Struct({
                ...OpenbotFileSummary.fields,
                agentId: Schema.NullOr(OpenbotFileScope.fields.agentId),
                status: Schema.Literals(["available", "missing"]),
                conversation: Schema.NullOr(Schema.Struct({ id: OpenbotFileScope.fields.agentId })),
              }),
            ).check(Schema.isMaxLength(2000)),
          }),
        ),
      ),
      Effect.mapError((cause) =>
        transport.isError(cause) ? cause : transport.error("decode", cause),
      ),
    );
    const file = data.files.find((file) => file.id === source.fileId);
    if (
      data.scope !== scope ||
      data.agentId !== scopedAgentId ||
      !file ||
      (scopedAgentId !== null && file.agentId !== scopedAgentId) ||
      file.status !== "available" ||
      (source.conversationId !== undefined && file.conversation?.id !== source.conversationId)
    )
      return yield* Effect.fail(transport.error("decode"));
    return projectAttachment(file);
  });
  const receipt = (data: typeof Sent.Type, agentId: string, taskId: string | null) => {
    const own = data.deliveries.filter((delivery) => delivery.recipientAgentId === agentId);
    return {
      messageId: data.messageId,
      conversationMessageId: own.length === 1 ? own[0]!.id : null,
      taskId,
    };
  };
  return {
    listWorkspace: Effect.fn("OpenbotFiles.protocol.listWorkspace")(function* (agentId, path) {
      const data = yield* post("/v1/workspace-directory", { agentId, path }).pipe(
        Effect.flatMap(decodeWorkspace),
        Effect.mapError((cause) =>
          transport.isError(cause) ? cause : transport.error("decode", cause),
        ),
      );
      return {
        name: data.name,
        path: data.path,
        parentPath: data.parentPath,
        entries: data.entries,
        truncated: data.truncated,
      };
    }),
    search: Effect.fn("OpenbotFiles.protocol.search")(function* (query, cursor, task) {
      if (task) {
        if (cursor !== undefined && !/^task-files:[0-9]{1,6}$/.test(cursor))
          return yield* Effect.fail(transport.error("decode"));
        const offset = cursor === undefined ? 0 : Number(cursor.slice("task-files:".length));
        const conversation = yield* readTask(
          task.agentId,
          yield* findTask(task.agentId, task.taskId),
        );
        const normalized = query.trim().toLocaleLowerCase();
        const all = conversation.messages.flatMap((message) =>
          (message.attachments ?? [])
            .filter((attachment) => attachment.name.toLocaleLowerCase().includes(normalized))
            .map((attachment) => ({
              agentId: task.agentId,
              taskId: task.taskId,
              messageId: message.id,
              createdAt: message.createdAt ?? "",
              attachment: projectAttachment(attachment),
            })),
        );
        return yield* decodeSearch({
          results: all.slice(offset, offset + 100),
          nextCursor: offset + 100 < all.length ? `task-files:${offset + 100}` : null,
        }).pipe(Effect.mapError((cause) => transport.error("decode", cause)));
      }
      const data = yield* post("/v1/conversation-files/search", {
        query,
        cursor: cursor ?? null,
        limit: 100,
      }).pipe(
        Effect.flatMap(decodeSearch),
        Effect.mapError((cause) =>
          transport.isError(cause) ? cause : transport.error("decode", cause),
        ),
      );
      return {
        nextCursor: data.nextCursor,
        results: data.results.map((entry) => ({
          agentId: entry.agentId,
          messageId: entry.messageId,
          createdAt: entry.createdAt,
          attachment: projectAttachment(entry.attachment),
        })),
      };
    }),
    attachment: Effect.fn("OpenbotFiles.protocol.attachment")(function* (agentId, source) {
      if (source.kind === "stored" || source.kind === "library")
        return yield* storedAttachment(agentId, source);
      if (agentId === null || (source.channelId !== undefined && source.taskId !== undefined))
        return yield* Effect.fail(transport.error("decode"));
      const message =
        source.channelId === undefined
          ? yield* conversationMessage(agentId, source.messageId, source.taskId)
          : yield* post("/v1/channels/read", {
              channelId: source.channelId,
              ...(source.beforeSequence === undefined
                ? {}
                : { beforeSequence: source.beforeSequence }),
            }).pipe(
              Effect.flatMap(decodeChannelPage),
              Effect.flatMap((page) => {
                const entry = page.messages.find(
                  (entry) => entry.id === source.messageId && entry.channelId === source.channelId,
                );
                return page.channel.id === source.channelId &&
                  page.channel.members.some((member) => member.agentId === agentId) &&
                  entry
                  ? Effect.succeed(entry.message)
                  : Effect.fail(transport.error("decode"));
              }),
              Effect.mapError((cause) =>
                transport.isError(cause) ? cause : transport.error("decode", cause),
              ),
            );
      const summary = message.attachments?.find((entry) => entry.id === source.attachmentId);
      if (!summary) return yield* Effect.fail(transport.error("decode"));
      return projectAttachment(summary);
    }),
    sentAttachments: Effect.fn("OpenbotFiles.protocol.sentAttachments")(
      function* (agentId, messageId, taskId) {
        const message = yield* conversationMessage(agentId, messageId, taskId);
        return (message.attachments ?? []).map(projectAttachment);
      },
    ),
    download: Effect.fn("OpenbotFiles.protocol.download")(function* (agentId, source) {
      if (agentId === null && source.kind !== "library")
        return yield* Effect.fail(transport.error("decode"));
      if (source.kind === "stored" || source.kind === "library")
        yield* storedAttachment(agentId, source);
      const path =
        source.kind === "stored" || source.kind === "library"
          ? `/v1/attachments/${encodeURIComponent(source.fileId)}`
          : source.kind === "attachment"
            ? `/v1/attachments/${encodeURIComponent(source.attachmentId)}`
            : source.kind === "local-skill"
              ? `/v1/admin/catalog/local/bundle?${new URLSearchParams({ skillId: source.skillId, revision: String(source.revision) })}`
              : source.kind === "shared"
                ? `/v1/shared-files?${new URLSearchParams({ path: source.path })}`
                : `/v1/workspace-files?${new URLSearchParams({ botId: agentId!, path: source.path })}`;
      const response = yield* get(path);
      const rawLength = response.headers["content-length"];
      const size = rawLength === undefined ? NaN : Number(rawLength);
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > 104_857_600 ||
        ![undefined, "identity"].includes(response.headers["content-encoding"])
      )
        return yield* Effect.fail(transport.error("decode"));
      return {
        size,
        mimeType:
          response.headers["content-type"]?.split(";", 1)[0]?.trim() || "application/octet-stream",
        body: response.stream.pipe(Stream.mapError((cause) => transport.error("transport", cause))),
      };
    }),
    queueAttachmentContext: Effect.fn("Files.protocol.queueAttachmentContext")(
      function* (principal, input) {
        const signed = transport.signedQueueAttachments;
        if (!signed || transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
        const compatibility = yield* get("/v1/compatibility").pipe(Effect.flatMap(transport.json));
        const capabilities = decodeQueueCapabilities(compatibility);
        if (capabilities._tag === "None") return yield* Effect.fail(transport.error("decode"));
        return yield* QueueAttachmentsProtocol.context(input, {
          capabilities: new Set(capabilities.value.capabilities),
          authorize: () =>
            transport.isClosed() ? Effect.fail(transport.error("closed")) : Effect.void,
          post: (path, body) => signed(principal, path, body),
        }).pipe(
          Effect.mapError((cause) =>
            transport.isError(cause) ? cause : transport.error("decode", cause),
          ),
        );
      },
    ),
    queueAttachments: Effect.fn("Files.protocol.queueAttachments")(
      function* (principal, input, resultOnly) {
        const signed = transport.signedQueueAttachments;
        if (!signed || transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
        const compatibility = yield* get("/v1/compatibility").pipe(Effect.flatMap(transport.json));
        const capabilities = decodeQueueCapabilities(compatibility);
        if (capabilities._tag === "None") return yield* Effect.fail(transport.error("decode"));
        return yield* QueueAttachmentsProtocol.dispatch(input, resultOnly, {
          principal,
          capabilities: new Set(capabilities.value.capabilities),
          authorize: () =>
            transport.isClosed() ? Effect.fail(transport.error("closed")) : Effect.void,
          post: (path, body) => signed(principal, path, body),
        }).pipe(
          Effect.mapError((cause) =>
            transport.isError(cause) ? cause : transport.error("decode", cause),
          ),
        );
      },
    ),
    originalUpload: Effect.fn("OpenbotFiles.protocol.originalUpload")(
      function* (principal, environmentId, identity, action, dataBase64) {
        if (transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
        if (!transport.signedFiles) return yield* Effect.fail(transport.error("decode"));
        const compatibility = yield* get("/v1/compatibility").pipe(Effect.flatMap(transport.json));
        if (
          !compatibility ||
          typeof compatibility !== "object" ||
          !("capabilities" in compatibility) ||
          !Array.isArray(compatibility.capabilities) ||
          !compatibility.capabilities.includes("sled-files-upload-recovery-v1") ||
          (identity.channelId !== undefined &&
            !compatibility.capabilities.includes(OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY))
        )
          return yield* Effect.fail(transport.error("decode"));
        const value = yield* transport.signedFiles(principal, `/v1/sled/files/${action}`, {
          ...identity,
          environmentId,
          ...(dataBase64 === undefined ? {} : { dataBase64 }),
        });
        return yield* decodeOriginalUploadReceipt(value).pipe(
          Effect.mapError((cause) => transport.error("decode", cause)),
        );
      },
    ),
    upload: Effect.fn("OpenbotFiles.protocol.upload")(function* (input) {
      if (transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
      // Drafts are host-wide upstream. Verify the intended conversation before admitting bytes.
      const agents = yield* get("/v1/agents").pipe(
        Effect.flatMap(transport.json),
        Effect.flatMap(decodeAgentIds),
        Effect.mapError((cause) =>
          transport.isError(cause) ? cause : transport.error("decode", cause),
        ),
      );
      if (!agents.some((agent) => agent.id === input.agentId))
        return yield* Effect.fail(transport.error("decode"));
      const request = transport
        .authenticated(
          `/v1/attachments?${new URLSearchParams({ name: input.name, mime: input.mimeType })}`,
          "POST",
        )
        .pipe(
          HttpClientRequest.bodyStream(input.body, {
            contentType: input.mimeType,
            contentLength: input.size,
          }),
        );
      const response = yield* transport.send(request).pipe(
        Effect.flatMap(transport.json),
        Effect.flatMap(decodeAttachment),
        Effect.mapError((cause) =>
          transport.isError(cause) ? cause : transport.error("decode", cause),
        ),
      );
      return projectAttachment(response);
    }),
    send: Effect.fn("OpenbotFiles.protocol.send")(
      function* (
        agentId,
        attachmentId,
        text,
        clientMessageId,
        target,
        reconcile,
        attachmentIds,
        replyToMessageId,
        expectedThreadId,
        authority,
      ) {
        const drafts = attachmentIds ?? [attachmentId];
        if (expectedThreadId !== undefined) {
          if (target.kind === "new-task") return yield* Effect.fail(transport.error("decode"));
          const compatibility = yield* get("/v1/compatibility").pipe(
            Effect.flatMap(transport.json),
          );
          if (
            !compatibility ||
            typeof compatibility !== "object" ||
            !("capabilities" in compatibility) ||
            !Array.isArray(compatibility.capabilities) ||
            !compatibility.capabilities.includes("sled-files-identity-v1")
          )
            return yield* Effect.fail(transport.error("decode"));
          if (authority && !compatibility.capabilities.includes("sled-files-upload-recovery-v1"))
            return yield* Effect.fail(transport.error("decode"));
          if (authority && !transport.signedFiles)
            return yield* Effect.fail(transport.error("decode"));
          if (target.kind === "channel") {
            if (
              !authority ||
              !transport.signedFiles ||
              expectedThreadId !== target.channelId ||
              !compatibility.capabilities.includes(OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY)
            )
              return yield* Effect.fail(transport.error("decode"));
            const accepted = yield* transport
              .signedFiles(authority.principal, "/v1/sled/files/channel-send", {
                environmentId: authority.environmentId,
                hostId: authority.hostId,
                channelId: target.channelId,
                agentId,
                clientMessageId,
                text,
                attachmentDraftIds: drafts,
                replyToMessageId: replyToMessageId ?? null,
              })
              .pipe(
                Effect.flatMap(decodeGroupFileReceipt),
                Effect.mapError((cause) =>
                  transport.isError(cause) ? cause : transport.error("decode", cause),
                ),
              );
            if (accepted.channelId !== target.channelId)
              return yield* Effect.fail(transport.error("decode"));
            return { messageId: accepted.receiptId, conversationMessageId: null, taskId: null };
          }
          const sendBody = {
            agentId,
            expectedThreadId,
            clientMessageId,
            text,
            attachmentDraftIds: drafts,
            taskId: target.kind === "task" ? target.taskId : null,
            replyToMessageId: replyToMessageId ?? null,
            receiptOnly: reconcile,
            ...(authority
              ? { environmentId: authority.environmentId, hostId: authority.hostId }
              : {}),
          };
          const response = yield* (
            authority
              ? transport.signedFiles!(authority.principal, "/v1/sled/files/send", sendBody)
              : post("/v1/sled/files/send", sendBody)
          ).pipe(
            Effect.flatMap(decodeSent),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          return receipt(response, agentId, target.kind === "task" ? target.taskId : null);
        }

        if (target.kind === "channel") {
          const page = yield* post("/v1/channels/read", { channelId: target.channelId }).pipe(
            Effect.flatMap(decodeChannelPage),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          if (
            page.channel.id !== target.channelId ||
            page.channel.archived ||
            !page.channel.members.some((member) => member.agentId === agentId)
          )
            return yield* Effect.fail(transport.error("decode"));
          // The authenticated member is the sender. A channel command receipt is keyed by this
          // stable operation id; sending an ordinary message is intentionally new channel work.
          const accepted = yield* post("/v1/channels/commands", {
            type: "send",
            channelId: target.channelId,
            operationId: clientMessageId,
            text,
            recipientAgentId: agentId,
            replyToMessageId: replyToMessageId ?? null,
            attachmentDraftIds: drafts,
          }).pipe(
            Effect.flatMap(decodeChannel),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          if (accepted.id !== target.channelId)
            return yield* Effect.fail(transport.error("decode"));
          return { messageId: null, conversationMessageId: null, taskId: null };
        }
        if (target.kind === "new-task") {
          if (reconcile) {
            // Start creates a task before deduplication, and commit assigns new attachment IDs.
            // Released reads cannot correlate this lost start with its clientMessageId.
            return null;
          }
          const task = yield* post("/v1/agent-threads/start-with-files", {
            agentId,
            text,
            attachmentDraftIds: drafts,
            clientMessageId,
          }).pipe(
            Effect.flatMap(decodeTask),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          if (task.agentId !== agentId) return yield* Effect.fail(transport.error("decode"));
          return { messageId: null, conversationMessageId: null, taskId: task.id };
        }
        if (target.kind === "task") {
          yield* findTask(agentId, target.taskId);
          const response = yield* post(
            replyToMessageId ? "/v1/agent-threads/send-reply" : "/v1/agent-threads/send-with-files",
            {
              agentId,
              taskId: target.taskId,
              text,
              clientMessageId,
              attachmentDraftIds: drafts,
              ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
            },
          ).pipe(
            Effect.flatMap(decodeSent),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          return receipt(response, agentId, target.taskId);
        }
        const response = yield* post(`/v1/agents/${encodeURIComponent(agentId)}/messages`, {
          text,
          clientMessageId,
          attachmentDraftIds: drafts,
          replyToMessageId: replyToMessageId ?? null,
        }).pipe(
          Effect.flatMap(decodeSent),
          Effect.mapError((cause) =>
            transport.isError(cause) ? cause : transport.error("decode", cause),
          ),
        );
        return receipt(response, agentId, null);
      },
    ),
    discard: Effect.fn("OpenbotFiles.protocol.discard")(function* (attachmentId) {
      if (transport.isClosed()) return yield* Effect.fail(transport.error("closed"));
      yield* transport.send(
        transport.authenticated(`/v1/attachments/${encodeURIComponent(attachmentId)}`, "DELETE"),
      );
    }),
  };
}
