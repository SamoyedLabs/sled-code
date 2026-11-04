import {
  OpenbotThreadReadState,
  OpenbotThreadBranchLink,
  OpenbotThreadBranchResult,
  OpenbotConversationReceipt,
  OpenbotConversationPage,
  OpenbotConversationSnapshot,
  OpenbotConversationReadState,
  type OpenbotConversationReadRequest,
  type OpenbotConversationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type Request = OpenbotConversationReadRequest | OpenbotConversationCommand;
export function isRequest(request: { readonly operation: string }): request is Request {
  return (
    [
      "conversation.page",
      "conversation.markRead",
      "conversation.markUnread",
      "conversation.react",
    ].includes(request.operation) || request.operation.startsWith("thread.")
  );
}
export function route(request: Request) {
  const { operation, agentId, ...input } = request;
  const agent = `/v1/agents/${encodeURIComponent(agentId)}`;
  if (request.operation === "conversation.page") {
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
          ([key]) =>
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
  "conversation.page": Schema.decodeUnknownEffect(OpenbotConversationPage),
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
