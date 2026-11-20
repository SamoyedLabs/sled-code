import { expect, it } from "@effect/vitest";
import type { OpenbotChannelMessage } from "@t3tools/contracts";
import {
  channelScheduleDraft,
  channelScheduleValue,
  channelEditDraft,
  channelSetVisibleMembers,
  channelSaveRequest,
  channelMessages,
  channelTaskActions,
  channelPromptSnapshot,
} from "./channels.ts";

it("binds group forms to the original member, thread, turn and live request", () => {
  const channel = {
    id: "group",
    name: "Team",
    title: "",
    instructions: "",
    members: [{ agentId: "bot" }],
    leadAgentId: "bot",
    revision: 3,
    archived: false,
    createdAt: "now",
    unreadCount: 0,
    activeTasks: 1,
    lastMessage: null,
    threads: [{ agentId: "bot", threadId: "group-thread" }],
  };
  const entry: OpenbotChannelMessage = {
    id: "row",
    channelId: "group",
    sequence: 3,
    author: { kind: "agent" as const, id: "bot", name: "Bot" },
    taskId: null,
    superseded: false,
    message: {
      id: "original-message",
      author: "assistant" as const,
      text: "Choose",
      createdAt: "now",
      status: "completed" as const,
      turnId: "turn",
      questionPrompt: { requestId: "prompt", resolution: null },
    },
  };
  const request = {
    kind: "prompt" as const,
    requestId: "prompt",
    agentId: "bot",
    threadId: "group-thread",
    turnId: "turn",
  };
  const attention = {
    hostId: "host",
    state: "ready" as const,
    complete: true,
    requests: [request],
  };
  const read = (e = entry, c = channel, a = attention) => channelPromptSnapshot("host", c, e, a);
  expect(read()).toMatchObject({
    agentId: "bot",
    threadId: "group-thread",
    activeTurnId: "turn",
    messages: [{ id: "original-message" }],
  });
  expect(read({ ...entry, superseded: true })).toBeNull();
  expect(read({ ...entry, channelId: "other" })).toBeNull();
  expect(read(entry, { ...channel, archived: true })).toBeNull();
  expect(read(entry, { ...channel, members: [] })).toBeNull();
  expect(read(entry, channel, { ...attention, hostId: "other" })).toBeNull();
  for (const altered of [
    { threadId: "main-thread" },
    { turnId: "old-turn" },
    { requestId: "other" },
    { agentId: "other" },
  ]) {
    expect(
      read(entry, channel, { ...attention, requests: [{ ...request, ...altered }] }),
    ).toBeNull();
  }
  expect(
    read({
      ...entry,
      message: {
        ...entry.message,
        questionPrompt: { requestId: "prompt", resolution: "answered" },
      },
    }),
  ).toBeNull();
});

it("preserves unlisted channel members and lead while editing and rejects a stale settings save", () => {
  const channel = {
    id: "channel-one",
    name: "Team",
    title: "Shared work",
    instructions: "Coordinate",
    members: [{ agentId: "visible" }, { agentId: "unlisted" }],
    leadAgentId: "unlisted",
    revision: 3,
    archived: false,
    createdAt: "now",
  };
  const edit = channelSetVisibleMembers(channelEditDraft(channel), new Set(["visible", "new"]), [
    "new",
  ]);
  expect(edit.value.members).toEqual([{ agentId: "unlisted" }, { agentId: "new" }]);
  expect(edit.value.leadAgentId).toBe("unlisted");
  expect(channelSaveRequest(edit, "save-one", channel)).toMatchObject({
    update: true,
    operationId: "save-one",
    draft: { leadAgentId: "unlisted" },
  });
  expect(channelSaveRequest(edit, "save-one", { ...channel, revision: 5 })).not.toBeNull();
  expect(
    channelSaveRequest(edit, "save-one", {
      ...channel,
      revision: 5,
      instructions: "Other device changed this",
    }),
  ).toBeNull();
  expect(channelSaveRequest(edit, "save-one", null)).toBeNull();
  const cleared = channelSetVisibleMembers(
    channelEditDraft({ ...channel, leadAgentId: "visible" }),
    new Set(["visible"]),
    [],
  );
  expect(cleared.value.leadAgentId).toBeNull();
  expect(cleared.value.members).toEqual([{ agentId: "unlisted" }]);
});

it("merges live channel messages over loaded history and follows released paused-task controls", () => {
  const channel = {
    id: "one",
    name: "Team",
    title: "",
    instructions: "",
    members: [],
    leadAgentId: null,
    revision: 1,
    archived: false,
    createdAt: "now",
  };
  const message = {
    id: "reply",
    channelId: "one",
    sequence: 2,
    author: { kind: "agent" as const, id: "bot", name: "Bot" },
    taskId: null,
    superseded: false,
    message: {
      id: "reply",
      author: "assistant" as const,
      text: "Partial",
      createdAt: "now",
      status: "streaming" as const,
    },
  };
  const old = { channel, messages: [message], tasks: [], olderCursor: null, throughSequence: 2 };
  const latest = {
    ...old,
    messages: [
      {
        ...message,
        message: { ...message.message, text: "Finished", status: "completed" as const },
      },
    ],
  };
  const mixed = {
    ...old,
    channel: { ...channel, id: "another" },
    messages: [{ ...message, channelId: "another" }],
  };
  expect(channelMessages("one", [old, mixed, latest])).toMatchObject([
    { id: "reply", message: { text: "Finished", status: "completed" } },
  ]);
  expect(channelTaskActions("running", false)).toEqual(["stop", "reassign"]);
  expect(channelTaskActions("paused", false)).toEqual(["resume", "reassign", "cancel"]);
  expect(channelTaskActions("failed", false)).toEqual(["resume", "reassign", "cancel"]);
  expect(channelTaskActions("paused", true)).toEqual([]);
  expect(channelTaskActions("completed", false)).toEqual([]);
});

it("retains an advanced channel schedule on edit and rejects incomplete numeric fields", () => {
  const schedule = {
    kind: "advanced" as const,
    months: [1, 6],
    days: { kind: "days-of-week" as const, days: [1, 5] },
    time: { kind: "every" as const, amount: 3, unit: "hours" as const },
  };
  expect(channelScheduleValue(channelScheduleDraft(schedule))).toEqual(schedule);
  expect(
    channelScheduleValue({ ...channelScheduleDraft(), kind: "hourly", minute: "" }),
  ).toBeNull();
});
