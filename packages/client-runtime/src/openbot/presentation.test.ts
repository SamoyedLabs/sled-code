import { expect, it } from "@effect/vitest";
import {
  conversationView,
  taskViews,
  memoryViews,
  routineViews,
  permissionView,
  instructionView,
  promptAnswerRequest,
} from "./presentation.ts";

it("reads a released conversation while keeping its messages independent of owner ID spelling", () => {
  expect(
    conversationView({
      botId: "school",
      threadId: "main",
      activeTurnId: "turn",
      revision: 4,
      messages: [
        {
          id: "reply",
          author: "assistant",
          text: "Assignment due Friday",
          status: "streaming",
          attachments: [],
        },
      ],
    }),
  ).toEqual({
    activeTurnId: "turn",
    messages: [
      { id: "reply", author: "assistant", text: "Assignment due Friday", status: "streaming" },
    ],
  });
  expect(
    conversationView({
      activeTurnId: null,
      messages: [{ id: "bad", author: "assistant", text: 12, status: "completed" }],
    }),
  ).toBeNull();
});

it("submits complete prompt answers without changing private values or forwarding unrelated fields", () => {
  const request = {
    kind: "prompt" as const,
    requestId: "prompt1",
    agentId: "school",
    questions: [
      { id: "key", isSecret: true, header: "Key", question: "Enter key", options: null },
      {
        id: "days",
        isSecret: false,
        header: "Days",
        question: "Choose days",
        options: null,
        multiSelect: true,
      },
    ],
  };
  expect(promptAnswerRequest(request, { key: ["  private-value  "] })).toBeNull();
  expect(promptAnswerRequest(request, { key: ["x", "y"], days: ["Monday"] })).toBeNull();
  expect(
    promptAnswerRequest(request, {
      key: ["  private-value  "],
      days: ["Monday", "Tuesday"],
      unrelated: ["do not forward"],
    }),
  ).toEqual({
    operation: "prompt.respond",
    requestId: "prompt1",
    answers: { key: ["  private-value  "], days: ["Monday", "Tuesday"] },
  });
});

it("distinguishes empty collections from unsupported upstream response shapes", () => {
  expect(taskViews({ agentId: "school", tasks: [], limit: 4 })).toEqual([]);
  expect(memoryViews([])).toEqual([]);
  expect(routineViews([])).toEqual([]);
  expect(taskViews([])).toBeNull();
  expect(memoryViews([{ id: "x", text: null }])).toBeNull();
  expect(
    routineViews([{ id: "x", name: "Morning", instruction: "Check Canvas", active: "yes" }]),
  ).toBeNull();
});

it("keeps permission locks and original instruction text available to the editor", () => {
  expect(permissionView({ access: "full", autoApprove: false, autoApproveLocked: true })).toEqual({
    access: "full",
    autoApprove: false,
    autoApproveLocked: true,
  });
  expect(
    permissionView({ access: "full", autoApprove: "false", autoApproveLocked: false }),
  ).toBeNull();
  const original = "Respect project instructions.\n";
  expect(instructionView({ fileName: "AGENTS.md", exists: true, text: original })).toEqual({
    fileName: "AGENTS.md",
    exists: true,
    text: original,
  });
  expect(instructionView({ fileName: "private.txt", exists: true, text: original })).toBeNull();
});
