import { expect, it } from "vite-plus/test";
import { createAttachmentSources } from "./file-sources";

it("requires the exact observed message and task before requesting attachment bytes", () => {
  const sources = createAttachmentSources();
  expect(() => sources.get("file")).toThrow();
  sources.remember(
    { messages: [{ id: "message", attachments: [{ id: "file" }] }] },
    "agent",
    "task",
  );
  expect(sources.get("file")).toEqual({
    agentId: "agent",
    source: { kind: "attachment", attachmentId: "file", messageId: "message", taskId: "task" },
  });
  sources.clear();
  expect(() => sources.get("file")).toThrow();
});

it("refuses an ambiguous attachment reused across message scopes instead of guessing a principal target", () => {
  const sources = createAttachmentSources();
  const snapshot = { messages: [{ id: "message", attachments: [{ id: "file" }] }] };
  sources.remember(snapshot, "one");
  sources.remember(snapshot, "one");
  expect(sources.get("file").agentId).toBe("one");
  sources.remember(snapshot, "two");
  expect(() => sources.get("file")).toThrow(/ambiguous/);
});
