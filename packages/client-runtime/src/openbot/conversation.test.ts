import { expect, it } from "@effect/vitest";
import { boundedBotMessages, botMessageSections } from "./conversation.ts";
it("retains structured tool results and bounds merged history to the selected thread", () => {
  const message = {
    id: "m",
    author: "agent" as const,
    text: "",
    status: "completed" as const,
    createdAt: "now",
    itemType: "tool",
    tool: { name: "search", result: "Found" },
  };
  expect(botMessageSections(message)).toEqual([
    { kind: "tool", value: JSON.stringify(message.tool, null, 2) },
  ]);
  const page = {
    agentId: "a",
    threadId: "t",
    activeTurnId: null,
    revision: 1,
    references: {},
    pageInfo: { hasOlder: false, olderCursor: null },
    messages: Array.from({ length: 600 }, (_, index) => ({ ...message, id: String(index) })),
  };
  expect(boundedBotMessages("a", "t", [page])).toHaveLength(500);
  expect(boundedBotMessages("a", "other", [page])).toEqual([]);
});
