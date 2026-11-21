import {
  OpenbotPeople,
  OpenbotDirectSelf,
  OpenbotDirectThreads,
  OpenbotDirectPage,
  OpenbotDirectMessage,
  OpenbotDirectReadState,
  type OpenbotDirectReadRequest,
  type OpenbotDirectCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type Request = OpenbotDirectReadRequest | OpenbotDirectCommand;
export function isRequest(request: { readonly operation: string }): request is Request {
  return request.operation.startsWith("direct.");
}
// Released route-direct facade owns sender/recipient validation, idempotency and events.
// Sender identity comes exclusively from the authenticated host session, never client input.
export function route(request: Request) {
  const directProjection = request.operation;
  if (request.operation === "direct.people")
    return { method: "GET" as const, path: "/v1/team/presence", directProjection };
  if (request.operation === "direct.self")
    return { method: "GET" as const, path: "/v1/me", directProjection };
  if (request.operation === "direct.threads")
    return { method: "GET" as const, path: "/v1/direct/threads", directProjection };
  if (request.operation === "direct.send")
    return {
      method: "POST" as const,
      path: "/v1/direct/messages",
      directProjection,
      body: {
        memberId: request.memberId,
        text: request.text,
        clientMessageId: request.clientMessageId,
      },
    };
  const path = `/v1/direct/conversations/${encodeURIComponent(request.memberId)}`;
  if (request.operation === "direct.markRead")
    return {
      method: "POST" as const,
      path: `${path}/read`,
      directProjection,
      body: { throughSequence: request.throughSequence },
    };
  const query = new URLSearchParams({ limit: String(request.limit) });
  if (request.anchor.type === "before") query.set("before", request.anchor.cursor);
  if (request.anchor.type === "around") query.set("around", request.anchor.messageId);
  return { method: "GET" as const, path: `${path}/page?${query}`, directProjection };
}
const decoders = {
  "direct.people": Schema.decodeUnknownEffect(OpenbotPeople),
  "direct.self": Schema.decodeUnknownEffect(OpenbotDirectSelf),
  "direct.threads": Schema.decodeUnknownEffect(OpenbotDirectThreads),
  "direct.page": Schema.decodeUnknownEffect(OpenbotDirectPage),
  "direct.send": Schema.decodeUnknownEffect(OpenbotDirectMessage),
  "direct.markRead": Schema.decodeUnknownEffect(OpenbotDirectReadState),
};
const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotDirectProtocol.project")(
  (operation: Request["operation"], value: unknown) =>
    decoders[operation](value).pipe(Effect.flatMap(decodeJson)),
);
