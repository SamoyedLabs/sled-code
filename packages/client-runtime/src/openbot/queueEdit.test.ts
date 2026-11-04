import { expect, it } from "vite-plus/test";
import { BotQueueEditSession } from "./queueEdit.ts";

it("keeps an uncertain edit recoverable and initializes it from the acquired delivery", () => {
  const edits = new BotQueueEditSession();
  const pending = edits.begin("first", () => "edit-first");
  expect(edits.current).toEqual({ deliveryId: "first", editId: "edit-first", state: "pending" });
  expect(edits.begin("second", () => "edit-second")).toBeNull();
  expect(edits.begin("first", () => "must-not-replace-retry")).toBe(pending);
  const delivery = {
    id: "first",
    messageId: "message",
    recipientAgentId: "agent",
    sender: null,
    text: "Accepted update from another device",
    attachments: [{ id: "current-attachment", name: "current.txt" }],
    replyToMessageId: null,
    status: "queued" as const,
    position: 0,
    turnId: null,
    error: null,
    createdAt: "now",
    editing: true,
  };
  expect(edits.confirm("wrong-edit", delivery)).toBe(pending);
  expect(edits.confirm("edit-first", { ...delivery, editing: false })).toBe(pending);
  expect(edits.confirm("edit-first", delivery)).toEqual({
    deliveryId: "first",
    editId: "edit-first",
    state: "ready",
    text: "Accepted update from another device",
    keepAttachmentIds: ["current-attachment"],
  });
  expect(edits.retainAttachments("wrong-edit", [])).toMatchObject({
    keepAttachmentIds: ["current-attachment"],
  });
  expect(edits.retainAttachments("edit-first", ["invented"])).toMatchObject({
    keepAttachmentIds: ["current-attachment"],
  });
  expect(edits.retainAttachments("edit-first", [])).toMatchObject({ keepAttachmentIds: [] });
  expect(edits.changeText("My new draft")).toMatchObject({ text: "My new draft" });
  expect(edits.finish("wrong-edit")).not.toBeNull();
  expect(edits.finish("edit-first")).toBeNull();
  const next = edits.begin("second", () => "edit-second");
  expect(edits.confirm("edit-first", delivery)).toBe(next);
});
