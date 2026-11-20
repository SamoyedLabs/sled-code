import { expect, it } from "vite-plus/test";
import type { OpenbotConversationPage } from "@t3tools/contracts";
import { assistantReceipt, resolveRoutineAssistant } from "./routineAssistant";
const attempt = { clientMessageId: "client", deliveryId: "delivery", messageId: "delivery" };
const page = (
  messages: OpenbotConversationPage["messages"],
  revision = 2,
  activeTurnId: string | null = null,
): OpenbotConversationPage => ({
  agentId: "owner",
  threadId: "thread",
  activeTurnId,
  revision,
  messages,
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
});
const asked = {
  id: "delivery",
  author: "user" as const,
  text: "Change my routine",
  status: "completed" as const,
  createdAt: "now",
  turnId: "own",
  delivery: { status: "completed" },
};
const answer = {
  id: "answer",
  author: "assistant" as const,
  text: "Saved.",
  status: "completed" as const,
  createdAt: "now",
  turnId: "own",
};
it("waits through queued/active work, ignores other turns and stale latest pages, then returns only the final answer", () => {
  expect(
    assistantReceipt(
      {
        deliveries: [
          { id: "foreign", recipientAgentId: "other" },
          { id: "delivery", recipientAgentId: "owner" },
        ],
      },
      "owner",
      "client",
    ),
  ).toEqual(attempt);
  const unrelated = { ...answer, id: "other", turnId: "other", text: "Unrelated" };
  const queued = page([{ ...asked, delivery: { status: "queued" } }, unrelated]);
  expect(resolveRoutineAssistant(attempt, queued, queued)).toEqual({ kind: "waiting" });
  const active = page([asked, answer], 2, "own");
  expect(resolveRoutineAssistant(attempt, active, active)).toEqual({ kind: "waiting" });
  expect(resolveRoutineAssistant(attempt, page([asked, answer], 3), page([unrelated], 2))).toEqual({
    kind: "waiting",
  });
  const complete = page(
    [asked, { ...answer, id: "trace", itemType: "commentary", text: "Working" }, answer, unrelated],
    3,
  );
  expect(resolveRoutineAssistant(attempt, complete, complete)).toEqual({
    kind: "complete",
    answer,
  });
  const failed = page([{ ...asked, delivery: { status: "interrupted" } }]);
  expect(resolveRoutineAssistant(attempt, failed, failed).kind).toBe("failed");
});
