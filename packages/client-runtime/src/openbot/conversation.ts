import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotConversationPage,
  OpenbotConversationSnapshot,
  OpenbotQueueSnapshot,
  type OpenbotConversationMessage,
} from "@t3tools/contracts";
const page = Schema.decodeUnknownResult(OpenbotConversationPage);
const snapshot = Schema.decodeUnknownResult(OpenbotConversationSnapshot);
const queue = Schema.decodeUnknownResult(OpenbotQueueSnapshot);
export function botConversationPage(value: unknown) {
  const result = page(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function botConversationSnapshot(value: unknown) {
  const result = snapshot(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function botQueueSnapshot(value: unknown) {
  const result = queue(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function boundedBotMessages(
  agentId: string,
  threadId: string | null,
  pages: readonly OpenbotConversationPage[],
) {
  const messages = new Map<string, OpenbotConversationMessage>();
  for (const page of pages)
    if (page.agentId === agentId && page.threadId === threadId)
      for (const message of page.messages) messages.set(message.id, message);
  return [...messages.values()].slice(-500);
}
export function botMessageSections(message: OpenbotConversationMessage) {
  return [
    "tool",
    "toolCall",
    "toolResult",
    "artifact",
    "plan",
    "subagents",
    "attachments",
    "imageGeneration",
    "questionPrompt",
    "uiBlock",
    "exchange",
    "memoryChanges",
    "instructionsChange",
    "reaction",
    "reactions",
  ].flatMap((key) =>
    message[key] == null
      ? []
      : [{ kind: key, value: JSON.stringify(message[key], null, 2).slice(0, 12000) }],
  );
}
