import { expect, it } from "vite-plus/test";
import type { OpenbotChannelMessage } from "@t3tools/contracts";
import { groupDayMarker, projectGroupCommentary } from "./group-conversation";

function entry(
  id: string,
  agent: string,
  message: Partial<OpenbotChannelMessage["message"]> = {},
): OpenbotChannelMessage {
  return {
    id,
    channelId: "channel",
    sequence: 1,
    author: { kind: "agent", id: agent, name: agent },
    taskId: null,
    superseded: false,
    message: {
      id,
      author: "assistant",
      text: id,
      createdAt: "2026-03-08T12:00:00",
      status: "completed",
      turnId: "turn",
      ...message,
    },
  };
}

it("marks local days, including the daylight-saving boundary, and skips invalid dates", () => {
  const now = new Date(2026, 2, 9, 12);
  const yesterday = new Date(2026, 2, 8, 12).toISOString();
  expect(groupDayMarker(undefined, yesterday, now)).toMatch(/^Yesterday /);
  expect(groupDayMarker(undefined, now.toISOString(), now)).toMatch(/^Today /);
  expect(groupDayMarker(new Date(2026, 2, 8, 1).toISOString(), yesterday, now)).toBeNull();
  expect(groupDayMarker(undefined, "invalid", now)).toBeNull();
  expect(groupDayMarker("invalid", yesterday, now)).toMatch(/^Yesterday /);
});

it("folds interleaved commentary above each author's first answer without mixing agents", () => {
  const a1 = entry("a1", "a", { itemType: "commentary" });
  const b1 = entry("b1", "b", { itemType: "commentary" });
  const a2 = entry("a2", "a", { itemType: "commentary" });
  const answerA = entry("answer-a", "a");
  const answerB = entry("answer-b", "b");
  const secondA = entry("second-a", "a");
  const result = projectGroupCommentary([a1, b1, a2, answerA, answerB, secondA]);
  expect(result.rows).toEqual([answerA, answerB, secondA]);
  expect(result.above.get(answerA.id)?.entries).toEqual([a1, a2]);
  expect(result.above.get(answerB.id)?.entries).toEqual([b1]);
  expect(result.above.has(secondA.id)).toBe(false);
  expect(result.pending).toEqual([]);
});

it("retains unanswered commentary and keeps superseded attempts separate", () => {
  const old = { ...entry("old", "a", { itemType: "commentary" }), superseded: true };
  const current = entry("current", "a", { itemType: "commentary", status: "streaming" });
  const result = projectGroupCommentary([old, current]);
  expect(result.rows).toEqual([]);
  expect(result.pending.map((group) => group.entries)).toEqual([[old], [current]]);
});

it("keeps rich commentary in the timeline so attachment and privileged-message joins survive", () => {
  const rows = [
    entry("ui", "a", { itemType: "commentary", uiBlock: { id: "block" } }),
    entry("question", "a", { itemType: "commentary", questionPrompt: { id: "question" } }),
    entry("image", "a", { itemType: "commentary", imageGeneration: { id: "image" } }),
    entry("attachment", "a", {
      itemType: "commentary",
      attachments: [
        {
          id: "file",
          name: "file",
          size: 1,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "text",
          previewUrl: null,
        },
      ],
    }),
  ];
  const result = projectGroupCommentary(rows);
  expect(result.rows).toEqual(rows);
  expect(result.pending).toEqual([]);
  expect(result.above.size).toBe(0);
});

it("does not merge unrelated commentary when the channel has no turn identifier", () => {
  const first = entry("first", "a", { itemType: "commentary" });
  const second = entry("second", "a", { itemType: "commentary" });
  const { turnId: _firstTurn, ...firstMessage } = first.message;
  const { turnId: _secondTurn, ...secondMessage } = second.message;
  const result = projectGroupCommentary([
    { ...first, message: firstMessage },
    { ...second, message: secondMessage },
  ]);
  expect(result.pending).toHaveLength(2);
});
