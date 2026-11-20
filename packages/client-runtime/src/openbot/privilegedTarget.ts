import type { OpenbotConversationMessage, OpenbotConversationSnapshot } from "@t3tools/contracts";
import {
  normalizeConversationUiBlock,
  isSecretFormField,
  uiBlockHasPrivilegedAction,
} from "@t3tools/contracts/openbot-ui-blocks";
export function privilegedTarget(
  snapshot: typeof OpenbotConversationSnapshot.Type | null,
  message: OpenbotConversationMessage,
) {
  if (!snapshot?.threadId || !message.turnId || snapshot.activeTurnId !== message.turnId)
    return null;
  const original = snapshot.messages.find(
    (m) => m.id === message.id && m.turnId === message.turnId,
  );
  if (!original) return null;
  const block = normalizeConversationUiBlock(original.uiBlock),
    prompt = original.questionPrompt;
  if (
    !block ||
    block.state.status !== "pending" ||
    !prompt ||
    typeof prompt !== "object" ||
    Array.isArray(prompt) ||
    !("requestId" in prompt) ||
    !("resolution" in prompt) ||
    prompt.resolution !== null ||
    (typeof prompt.requestId !== "string" && typeof prompt.requestId !== "number")
  )
    return null;
  if (
    !block.vault &&
    !(block.spec.type === "form" && block.spec.fields.some(isSecretFormField)) &&
    !uiBlockHasPrivilegedAction(block.spec)
  )
    return null;
  return {
    spec: block.spec,
    target: {
      agentId: snapshot.agentId,
      threadId: snapshot.threadId,
      turnId: message.turnId,
      messageId: message.id,
      blockId: block.blockId,
      requestId: prompt.requestId,
    },
  };
}
