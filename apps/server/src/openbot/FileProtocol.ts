import {
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

type Summary = OpenbotFileSummary;
type Source = OpenbotFileMaterializeInput["source"];
export interface FileSession<E> {
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
    agentId: string,
    source: Extract<Source, { kind: "attachment" }>,
  ) => Effect.Effect<Summary, E>;
  readonly download: (
    agentId: string,
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
  ) => Effect.Effect<
    { readonly messageId: string | null; readonly taskId: string | null } | null,
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
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
const decodeWorkspace = Schema.decodeUnknownEffect(OpenbotWorkspaceDirectory);
const decodeSearch = Schema.decodeUnknownEffect(OpenbotConversationFilePage);
const decodeAttachment = Schema.decodeUnknownEffect(OpenbotFileSummary);
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
      const data = yield* (
        source.taskId === undefined
          ? get(
              `/v1/agents/${encodeURIComponent(agentId)}/conversation-page?${new URLSearchParams({ around: source.messageId, limit: "100" })}`,
            ).pipe(Effect.flatMap(transport.json))
          : readTask(agentId, yield* findTask(agentId, source.taskId))
      ).pipe(
        Effect.flatMap(decodeConversation),
        Effect.mapError((cause) =>
          transport.isError(cause) ? cause : transport.error("decode", cause),
        ),
      );
      if (data.agentId !== agentId) return yield* Effect.fail(transport.error("decode"));
      const summary = data.messages
        .find((entry) => entry.id === source.messageId)
        ?.attachments?.find((entry) => entry.id === source.attachmentId);
      if (!summary) return yield* Effect.fail(transport.error("decode"));
      return projectAttachment(summary);
    }),
    download: Effect.fn("OpenbotFiles.protocol.download")(function* (agentId, source) {
      const path =
        source.kind === "attachment"
          ? `/v1/attachments/${encodeURIComponent(source.attachmentId)}`
          : `/v1/workspace-files?${new URLSearchParams({ botId: agentId, path: source.path })}`;
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
      function* (agentId, attachmentId, text, clientMessageId, target, reconcile) {
        if (target.kind === "new-task") {
          if (reconcile) {
            // startTask creates a task before deduplicating its first message. Never replay it.
            const found: Array<{ messageId: string; taskId: string }> = [];
            for (const task of yield* listTasks(agentId)) {
              const conversation = yield* readTask(agentId, task);
              const message = conversation.messages.find((message) =>
                message.attachments?.some((file) => file.id === attachmentId),
              );
              if (message) found.push({ messageId: message.id, taskId: task.id });
            }
            return found.length === 1 ? found[0]! : null;
          }
          const task = yield* post("/v1/agent-threads/start-with-files", {
            agentId,
            text,
            attachmentDraftIds: [attachmentId],
            clientMessageId,
          }).pipe(
            Effect.flatMap(decodeTask),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          if (task.agentId !== agentId) return yield* Effect.fail(transport.error("decode"));
          return { messageId: null, taskId: task.id };
        }
        if (target.kind === "task") {
          yield* findTask(agentId, target.taskId);
          const response = yield* post("/v1/agent-threads/send-with-files", {
            agentId,
            taskId: target.taskId,
            text,
            clientMessageId,
            attachmentDraftIds: [attachmentId],
          }).pipe(
            Effect.flatMap(decodeSent),
            Effect.mapError((cause) =>
              transport.isError(cause) ? cause : transport.error("decode", cause),
            ),
          );
          return { messageId: response.messageId, taskId: target.taskId };
        }
        const response = yield* post(`/v1/agents/${encodeURIComponent(agentId)}/messages`, {
          text,
          clientMessageId,
          attachmentDraftIds: [attachmentId],
          replyToMessageId: null,
        }).pipe(
          Effect.flatMap(decodeSent),
          Effect.mapError((cause) =>
            transport.isError(cause) ? cause : transport.error("decode", cause),
          ),
        );
        return { messageId: response.messageId, taskId: null };
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
