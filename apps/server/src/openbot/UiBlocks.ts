import type { OpenbotConversationSnapshot } from "@t3tools/contracts";
import { blockAnswers, type BlockCommand } from "@t3tools/contracts/openbot-ui-block-answer";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
export class UiBlockRefused extends Schema.TaggedError<UiBlockRefused>()("UiBlockRefused", {}) {}
/** The existing host-bound TeamClient supplies both ports from the same authenticated owner session.
 * No response is synthesized: successful upstream 204 remains null; conflicts/errors propagate.
 */
export const respond = Effect.fn("OpenbotUiBlocks.respond")(function* <E>(
  command: BlockCommand,
  ports: {
    readonly read: (
      agentId: string,
      taskId: string | null,
    ) => Effect.Effect<typeof OpenbotConversationSnapshot.Type, E>;
    readonly answer: (
      requestId: string | number,
      answers: Record<string, string[]>,
    ) => Effect.Effect<null, E>;
  },
) {
  const snapshot = yield* ports.read(command.agentId, command.taskId);
  const answers = blockAnswers(snapshot, command);
  if (answers === null) return yield* new UiBlockRefused({});
  return yield* ports.answer(command.requestId, answers);
});
