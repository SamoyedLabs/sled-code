import type {
  OpenbotConversationCommand,
  OpenbotConversationSnapshot,
} from "./openbotConversation.ts";
import {
  normalizeConversationUiBlock,
  uiBlockAnswersFromResponse,
  uiBlockActionIsPrivileged,
  validateUiBlockResponse,
} from "./openbotUiBlocks.ts";
export type BlockCommand = Extract<
  OpenbotConversationCommand,
  { operation: "conversation.blockRespond" }
>;
export function blockAnswers(
  snapshot: typeof OpenbotConversationSnapshot.Type,
  command: BlockCommand,
): Record<string, string[]> | null {
  if (
    snapshot.agentId !== command.agentId ||
    snapshot.threadId !== command.threadId ||
    snapshot.activeTurnId !== command.turnId
  )
    return null;
  const message = snapshot.messages.find(
    (m) => m.id === command.messageId && m.turnId === command.turnId,
  );
  if (!message) return null;
  const prompt = message.questionPrompt;
  if (
    !prompt ||
    typeof prompt !== "object" ||
    Array.isArray(prompt) ||
    !("requestId" in prompt) ||
    !("resolution" in prompt) ||
    prompt.requestId !== command.requestId ||
    prompt.resolution !== null
  )
    return null;
  const block = normalizeConversationUiBlock(message.uiBlock);
  if (
    !block ||
    block.blockId !== command.blockId ||
    block.state.status !== "pending" ||
    block.vault ||
    command.response.actionId === "_text" ||
    uiBlockActionIsPrivileged(block.spec, command.response.actionId)
  )
    return null;
  const response = validateUiBlockResponse(block.spec, command.response);
  return response ? uiBlockAnswersFromResponse(block.spec, response) : null;
}
