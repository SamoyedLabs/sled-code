import {
  OpenbotPinnedMessages,
  OpenbotPinnedThread,
  OpenbotThreadReadState,
  OpenbotThreadBranchLink,
  OpenbotThreadBranchResult,
  OpenbotConversationReceipt,
  OpenbotConversationPage,
  OpenbotConversationSearchPage,
  OpenbotConversationSnapshot,
  OpenbotConversationReadState,
  OpenbotConversationDetail,
  type OpenbotConversationReadRequest,
  type OpenbotConversationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type Request = OpenbotConversationReadRequest | OpenbotConversationCommand;
export function isRequest(request: { readonly operation: string }): request is Request {
  return (
    [
      "conversation.blockRespond",
      "conversation.page",
      "conversation.detail",
      "conversation.search",
      "conversation.markRead",
      "conversation.markUnread",
      "conversation.react",
      "conversation.message.delete",
    ].includes(request.operation) ||
    request.operation.startsWith("conversation.pins.") ||
    request.operation.startsWith("thread.")
  );
}
export function route(request: Request) {
  if (request.operation === "conversation.blockRespond")
    throw new Error("UI block responses require fresh snapshot validation.");
  if (request.operation === "conversation.search") {
    const query = new URLSearchParams({ q: request.query, limit: String(request.limit) });
    if (request.agentId !== undefined) query.set("botId", request.agentId);
    if (request.cursor !== undefined) query.set("cursor", request.cursor);
    return {
      method: "GET" as const,
      path: `/v1/messages/search?${query}`,
      conversationProjection: request.operation,
    };
  }
  if (request.operation === "conversation.message.delete") {
    return {
      method: "POST" as const,
      path: request.taskId === null ? "/v1/messages/delete" : "/v1/messages/delete-task",
      body:
        request.taskId === null
          ? { agentId: request.agentId, messageId: request.messageId }
          : { agentId: request.agentId, taskId: request.taskId, messageId: request.messageId },
      conversationProjection: request.operation,
    };
  }
  const { operation, agentId, ...input } = request;
  const agent = `/v1/agents/${encodeURIComponent(agentId)}`;
  if (
    operation === "conversation.pins.list" ||
    operation === "conversation.pins.set" ||
    operation === "conversation.pins.readThread"
  ) {
    const suffix = operation.split(".").at(-1);
    return {
      method: "POST" as const,
      path: `/v1/message-pins/${suffix === "readThread" ? "read-thread" : suffix}`,
      body: { agentId, ...input },
      conversationProjection: operation,
    };
  }
  if (request.operation === "conversation.detail")
    return {
      method: "POST" as const,
      path: "/v1/sled/conversation/detail",
      body: { agentId, ...input },
      conversationProjection: operation,
    };
  if (request.operation === "conversation.page") {
    if (request.deferDetails || request.taskId !== undefined)
      return {
        method: "POST" as const,
        path: "/v1/sled/conversation/page",
        body: {
          agentId,
          taskId: request.taskId ?? null,
          anchor: request.anchor,
          limit: request.limit,
        },
        conversationProjection: operation,
      };
    const query = new URLSearchParams({ limit: String(request.limit) });
    if (request.anchor.type === "before") query.set("before", request.anchor.cursor);
    if (request.anchor.type === "around") query.set("around", request.anchor.messageId);
    return {
      method: "GET" as const,
      path: `${agent}/conversation-page?${query}`,
      conversationProjection: operation,
    };
  }
  const paths = {
    "conversation.markRead": `${agent}/conversation/read`,
    "conversation.markUnread": `${agent}/conversation/unread`,
    "conversation.react": `${agent}/reactions`,
    "thread.reads": "/v1/agent-threads/reads",
    "thread.markRead": "/v1/agent-threads/read",
    "thread.rename": "/v1/agent-threads/rename",
    "thread.delete": "/v1/agent-threads/delete",
    "thread.branch": "/v1/agent-threads/branch",
    "thread.branches": "/v1/agent-threads/branches",
    "thread.reply": "/v1/agent-threads/send-reply",
  };
  return {
    method: "POST" as const,
    path: paths[request.operation],
    body: operation.startsWith("thread.") ? { agentId, ...input } : input,
    conversationProjection: operation,
  };
}
// Rich released message payloads remain data; private credentials and host-local URLs never leave the adapter.
export function publicRichValue(value: Schema.Json, depth = 0): Schema.Json {
  if (depth > 16) return null;
  if (Array.isArray(value))
    return value.slice(0, 2000).map((item) => publicRichValue(item, depth + 1));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, item]) =>
            ((key === "secret" || key === "isSecret") && typeof item === "boolean") ||
            !/token|secret|password|authorization|apiKey|cookie|credential|rawEvent|rawLog/i.test(
              key,
            ),
        )
        .map(([key, item]) => [
          key,
          /url$|path$/i.test(key) ? null : publicRichValue(item, depth + 1),
        ]),
    );
  return value;
}
const decoders = {
  "conversation.pins.list": Schema.decodeUnknownEffect(OpenbotPinnedMessages),
  "conversation.pins.set": Schema.decodeUnknownEffect(OpenbotPinnedMessages),
  "conversation.pins.readThread": Schema.decodeUnknownEffect(OpenbotPinnedThread),
  "conversation.search": Schema.decodeUnknownEffect(OpenbotConversationSearchPage),
  "conversation.page": Schema.decodeUnknownEffect(OpenbotConversationPage),
  "conversation.detail": Schema.decodeUnknownEffect(OpenbotConversationDetail),
  "conversation.read": Schema.decodeUnknownEffect(OpenbotConversationSnapshot),
  "task.read": Schema.decodeUnknownEffect(OpenbotConversationSnapshot),
  "conversation.markRead": Schema.decodeUnknownEffect(OpenbotConversationReadState),
  "conversation.markUnread": Schema.decodeUnknownEffect(OpenbotConversationReadState),
  "thread.reads": Schema.decodeUnknownEffect(
    Schema.Struct({ reads: Schema.Array(OpenbotThreadReadState).check(Schema.isMaxLength(1000)) }),
  ),
  "thread.markRead": Schema.decodeUnknownEffect(OpenbotThreadReadState),
  "thread.branch": Schema.decodeUnknownEffect(OpenbotThreadBranchResult),
  "thread.branches": Schema.decodeUnknownEffect(
    Schema.Struct({
      branches: Schema.Array(
        Schema.Struct({ taskId: Schema.String, ...OpenbotThreadBranchLink.fields }),
      ).check(Schema.isMaxLength(50)),
    }),
  ),
  "thread.reply": Schema.decodeUnknownEffect(OpenbotConversationReceipt),
  "thread.rename": Schema.decodeUnknownEffect(Schema.Struct({})),
  "thread.delete": Schema.decodeUnknownEffect(Schema.Struct({})),
  "conversation.message.delete": Schema.decodeUnknownEffect(Schema.Struct({})),
  "conversation.react": Schema.decodeUnknownEffect(Schema.Struct({})),
};
const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotConversationProtocol.project")((
  operation: keyof typeof decoders,
  value: unknown,
) => {
  const decode: (value: unknown) => Effect.Effect<unknown, Schema.SchemaError> =
    decoders[operation];
  return decode(value).pipe(
    Effect.flatMap(decodeJson),
    Effect.map((value) => publicRichValue(value)),
  );
});
