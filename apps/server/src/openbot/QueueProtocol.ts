import { OpenbotQueueSnapshot, type OpenbotQueueCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { publicRichValue } from "./ConversationProtocol.ts";
export function isRequest(request: { readonly operation: string }): request is OpenbotQueueCommand {
  return request.operation.startsWith("queue.") && request.operation !== "queue.read";
}
export function route(request: OpenbotQueueCommand) {
  const { operation, agentId, ...body } = request;
  const action =
    operation === "queue.acknowledgeFailure"
      ? "failures/acknowledge"
      : `queue/${operation.slice(6)}`;
  return {
    method: "POST" as const,
    path: `/v1/agents/${encodeURIComponent(agentId)}/${action}`,
    body,
    queueProjection: operation,
  };
}
const decodeSnapshot = Schema.decodeUnknownEffect(OpenbotQueueSnapshot);
const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotQueueProtocol.project")((value: unknown) =>
  decodeSnapshot(value).pipe(
    Effect.flatMap(decodeJson),
    Effect.map((value) => publicRichValue(value)),
  ),
);
