import { describe, expect, it } from "vite-plus/test";
import type { OpenbotConversationMessage } from "@t3tools/contracts";
import {
  botBranchDividerAfterId,
  botBranchPointIds,
  botCanDeleteConversationMessage,
  botChildBranchesByMessage,
  decodeBotThreadBranches,
} from "./bot-branch-markers";

function message(
  overrides: Partial<OpenbotConversationMessage> & {
    id: string;
    author: OpenbotConversationMessage["author"];
  },
): OpenbotConversationMessage {
  return {
    text: "Hello",
    status: "completed",
    createdAt: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

describe("bot-branch-markers", () => {
  it("selects only the final finished assistant answer per completed turn", () => {
    const messages: OpenbotConversationMessage[] = [
      message({ id: "u1", author: "user", text: "Hi" }),
      message({
        id: "a1",
        author: "assistant",
        turnId: "t1",
        itemType: "commentary",
        text: "Working",
      }),
      message({ id: "a2", author: "assistant", turnId: "t1", text: "Draft answer" }),
      message({ id: "a3", author: "assistant", turnId: "t1", text: "Final answer" }),
      message({ id: "u2", author: "user", text: "Next" }),
      message({ id: "a4", author: "agent", turnId: "t2", text: "Streaming", status: "streaming" }),
    ];

    expect([...botBranchPointIds(messages, "t2")]).toEqual(["a3"]);
    expect([...botBranchPointIds(messages.slice(0, 4), null)]).toEqual(["a3"]);
  });

  it("places the branch divider after the last visible inherited message", () => {
    const messages: OpenbotConversationMessage[] = [
      message({ id: "u1", author: "user", text: "Question" }),
      message({ id: "a1", author: "assistant", text: "Answer" }),
      message({ id: "s1", author: "assistant", itemType: "subagents", text: "" }),
      message({ id: "u2", author: "user", text: "Follow-up in branch" }),
    ];

    expect(botBranchDividerAfterId(messages, "s1", (item) => item.itemType === "subagents")).toBe(
      "a1",
    );
    expect(botBranchDividerAfterId(messages, "missing")).toBeNull();
  });

  it("decodes thread.branches payloads and groups child branches by source message", () => {
    const branches = decodeBotThreadBranches({
      branches: [
        {
          taskId: "task-b1",
          sourceTaskId: null,
          sourceTitle: null,
          sourceMessageId: "a1",
          throughMessageId: "a1",
        },
        {
          taskId: "task-b2",
          sourceTaskId: "task-b1",
          sourceTitle: "First branch",
          sourceMessageId: "a2",
          throughMessageId: "a2",
        },
      ],
    });

    expect(branches).toHaveLength(2);
    expect(
      botChildBranchesByMessage(branches, null)
        .get("a1")
        ?.map((b) => b.taskId),
    ).toEqual(["task-b1"]);
    expect(
      botChildBranchesByMessage(branches, "task-b1")
        .get("a2")
        ?.map((b) => b.taskId),
    ).toEqual(["task-b2"]);
  });

  it("disallows deleting system, streaming, or active-turn messages", () => {
    expect(
      botCanDeleteConversationMessage({ author: "user", status: "completed", turnId: "t1" }, "t2"),
    ).toBe(true);
    expect(
      botCanDeleteConversationMessage(
        { author: "assistant", status: "completed", turnId: "t2" },
        "t2",
      ),
    ).toBe(false);
    expect(
      botCanDeleteConversationMessage(
        { author: "assistant", status: "streaming", turnId: "t1" },
        null,
      ),
    ).toBe(false);
    expect(botCanDeleteConversationMessage({ author: "system", status: "completed" }, null)).toBe(
      false,
    );
  });
});
