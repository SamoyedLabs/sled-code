import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { OpenbotAdminRequest, OpenbotAttentionRequest } from "@t3tools/contracts";
export * from "./providers.ts";
export * from "./connections.ts";
export * from "./codingPolicy.ts";
export * from "./hostRecovery.ts";
export * from "./maintenance.ts";
export * from "./workflows.ts";
export * from "./channels.ts";

const Message = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  text: Schema.String,
  status: Schema.String,
});
const Conversation = Schema.Struct({
  messages: Schema.Array(Message),
  activeTurnId: Schema.NullOr(Schema.String),
});
const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  state: Schema.String,
  outcome: Schema.NullOr(Schema.String),
});
const Tasks = Schema.Struct({ tasks: Schema.Array(Task) });
const Memory = Schema.Struct({ id: Schema.String, text: Schema.String });
const Memories = Schema.Array(Memory);
const Routine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  instruction: Schema.String,
  active: Schema.Boolean,
});
const Routines = Schema.Array(Routine);
const decodeConversation = Schema.decodeUnknownResult(Conversation);
const decodeTasks = Schema.decodeUnknownResult(Tasks);
const decodeMemories = Schema.decodeUnknownResult(Memories);
const decodeRoutines = Schema.decodeUnknownResult(Routines);

export function promptAnswerRequest(
  request: OpenbotAttentionRequest,
  answers: Readonly<Record<string, readonly string[]>>,
): OpenbotAdminRequest | null {
  if (request.kind !== "prompt" || !request.questions?.length) return null;
  const entries: Array<[string, string[]]> = [];
  let size = 0;
  for (const question of request.questions) {
    const values = answers[question.id] ?? [];
    if (
      values.length === 0 ||
      values.length > 32 ||
      (!question.multiSelect && values.length > 1) ||
      values.some((value) => value.trim().length === 0)
    )
      return null;
    size += values.reduce((total, value) => total + value.length, 0);
    if (size > 100_000) return null;
    entries.push([question.id, [...values]]);
  }
  if (new Set(entries.map(([id]) => id)).size !== entries.length) return null;
  return {
    operation: "prompt.respond",
    requestId: request.requestId,
    answers: Object.fromEntries(entries),
  };
}

export function conversationView(value: unknown) {
  const result = decodeConversation(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function taskViews(value: unknown) {
  const result = decodeTasks(value);
  return Result.isSuccess(result) ? result.success.tasks : null;
}
export function memoryViews(value: unknown) {
  const result = decodeMemories(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function routineViews(value: unknown) {
  const result = decodeRoutines(value);
  return Result.isSuccess(result) ? result.success : null;
}

import type { OpenbotReadRequest } from "@t3tools/contracts";
export function botViewRequest(
  agentId: string,
  view: "conversation" | "task" | "memory" | "routine",
  taskId: string | null,
): OpenbotReadRequest {
  if (view === "task" && taskId !== null) return { operation: "task.read", agentId, taskId };
  return {
    operation:
      view === "conversation"
        ? "conversation.read"
        : view === "task"
          ? "task.list"
          : view === "memory"
            ? "memory.list"
            : "routine.list",
    agentId,
  };
}

const Permissions = Schema.Struct({
  access: Schema.Literals(["full", "workspace"]),
  autoApprove: Schema.Boolean,
  autoApproveLocked: Schema.Boolean,
});
const Instructions = Schema.Struct({
  fileName: Schema.Literals(["AGENTS.md", "CLAUDE.md"]),
  exists: Schema.Boolean,
  text: Schema.String,
});
const decodePermissions = Schema.decodeUnknownResult(Permissions);
const decodeInstructions = Schema.decodeUnknownResult(Instructions);
export function permissionView(value: unknown) {
  const result = decodePermissions(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function instructionView(value: unknown) {
  const result = decodeInstructions(value);
  return Result.isSuccess(result) ? result.success : null;
}

export const sledToolAccessOptions = [
  { value: "read-only", label: "Read only" },
  { value: "approval-required", label: "Ask before actions" },
  { value: "auto-accept-edits", label: "Allow edits" },
  { value: "auto", label: "Automatic" },
  { value: "full-access", label: "Full access" },
] as const;
export {
  browserDisplay,
  browserProfiles,
  browserTabActions,
  browserActionLabel,
} from "./browser.ts";
export { browserViewerConnection } from "./browserViewer.ts";
export { BrowserKeyboard } from "./browserKeyboard.ts";

export * from "./conversation.ts";
export { BotQueueEditSession, type BotQueueEdit } from "./queueEdit.ts";
export * from "./routineEvents.ts";

export * from "./vault.ts";

export * from "./computer.ts";
export type { ComputerActions } from "./computerController.ts";

export * from "./data.ts";

export { computerViewerUrl } from "./computerViewer.ts";
