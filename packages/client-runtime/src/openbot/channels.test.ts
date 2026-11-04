import { expect, it } from "@effect/vitest";
import {
  channelEditDraft,
  channelSetVisibleMembers,
  channelSaveRequest,
  channelMessages,
  channelTaskActions,
} from "./channels.ts";

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
