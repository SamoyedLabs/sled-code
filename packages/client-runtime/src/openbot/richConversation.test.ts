import { expect, it } from "vite-plus/test";
import {
  blockAnswers,
  blockValuesAfterAttempt,
  selectableDraft,
  acceptedDraft,
  type BlockCommand,
} from "./richConversation.ts";
import type { OpenbotDraftFile } from "@t3tools/contracts";
const spec = {
  type: "choice",
  title: "Pick",
  options: [
    { id: "one", label: "One" },
    { id: "two", label: "Two" },
  ],
};
const message = {
  id: "m",
  turnId: "turn",
  author: "agent" as const,
  text: "Pick",
  status: "completed" as const,
  createdAt: "now",
  questionPrompt: { requestId: 7, resolution: null },
  uiBlock: { version: 1, blockId: "block", spec, state: { status: "pending" } },
};
const snapshot = {
  agentId: "a",
  threadId: "thread",
  activeTurnId: "turn",
  revision: 1,
  messages: [message],
};
const command: BlockCommand = {
  operation: "conversation.blockRespond",
  agentId: "a",
  taskId: "task",
  threadId: "thread",
  turnId: "turn",
  messageId: "m",
  blockId: "block",
  requestId: 7,
  response: { actionId: "submit", values: { selected: ["two"] } },
};
it("answers the original live block using released fallback labels and refuses stale identity or invalid values", () => {
  expect(blockAnswers(snapshot, command)).toEqual({ choice: ["Two"] });
  for (const change of [
    { agentId: "other" },
    { threadId: null },
    { turnId: "old" },
    { messageId: "old" },
    { blockId: "old" },
    { requestId: "7" },
    { response: { actionId: "submit", values: { selected: ["missing"] } } },
  ])
    expect(blockAnswers(snapshot, { ...command, ...change })).toBeNull();
  expect(blockAnswers({ ...snapshot, activeTurnId: null }, command)).toBeNull();
  expect(
    blockAnswers(
      {
        ...snapshot,
        messages: [
          { ...message, questionPrompt: { requestId: 7, resolution: { status: "answered" } } },
        ],
      },
      command,
    ),
  ).toBeNull();
  for (const block of [
    { ...message.uiBlock, state: { status: "expired" } },
    { ...message.uiBlock, spec: { type: "future" } },
    {
      ...message.uiBlock,
      spec: {
        type: "confirm",
        title: "Delete",
        actions: [{ id: "submit", label: "Delete", style: "danger" }],
      },
    },
  ])
    expect(
      blockAnswers({ ...snapshot, messages: [{ ...message, uiBlock: block }] }, command),
    ).toBeNull();
});
const scope = { hostId: "host", agentId: "a" };
const target = { kind: "task" as const, taskId: "task" };
const draft: OpenbotDraftFile = {
  ...scope,
  attachment: {
    id: "draft",
    name: "x.txt",
    size: 1,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
  },
  sha256: "a".repeat(64),
  state: "ready",
  sendText: null,
  messageId: null,
  conversationMessageId: null,
  committedAttachments: null,
  target: null,
  taskId: null,
};
it("keeps selection separate from acceptance and rejects cross-host/task or phantom receipts", () => {
  expect(selectableDraft(scope, target, draft)).toBe(true);
  expect(selectableDraft({ ...scope, hostId: "other" }, target, draft)).toBe(false);
  expect(
    selectableDraft(scope, target, {
      ...draft,
      state: "sending",
      target: { kind: "task", taskId: "other" },
    }),
  ).toBe(false);
  expect(acceptedDraft(scope, target, "draft", draft)).toBe(false);
  const sent = {
    ...draft,
    target,
    state: "sent" as const,
    messageId: "queued-receipt",
    taskId: "task",
  };
  expect(acceptedDraft(scope, target, "draft", sent)).toBe(true);
  expect(acceptedDraft(scope, target, "draft", { ...sent, taskId: "other-task" })).toBe(false);
  expect(acceptedDraft(scope, { kind: "main" }, "draft", sent)).toBe(false);
  expect(acceptedDraft(scope, target, "other-draft", sent)).toBe(false);
  expect(acceptedDraft(scope, target, "draft", { ...sent, messageId: null })).toBe(false);
});

it("preserves ordinary failed form values but discards secret buffers after every attempt", () => {
  const form = {
    version: 1,
    blockId: "form",
    spec: {
      type: "form",
      title: "Provide details",
      fields: [
        { id: "name", kind: "text", label: "Name" },
        { id: "key", kind: "text", label: "Key", secret: true },
      ],
      actions: [{ id: "submit", label: "Submit" }],
    },
    state: { status: "pending" },
  };
  const values = { name: "Keep my draft", key: "Transient private value" };
  expect(blockValuesAfterAttempt(form, values, false)).toEqual({ name: "Keep my draft" });
  expect(blockValuesAfterAttempt(form, values, true)).toEqual({});
  expect(values.key).toBe("Transient private value");
  expect(blockValuesAfterAttempt(message.uiBlock, { selected: ["two"] }, false)).toEqual({
    selected: ["two"],
  });
});
