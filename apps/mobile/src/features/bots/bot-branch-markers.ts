import { OpenbotThreadBranchLink, type OpenbotConversationMessage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type BotThreadBranch = {
  readonly taskId: string;
  readonly sourceTaskId: string | null;
  readonly sourceTitle: string | null;
  readonly sourceMessageId: string;
  readonly throughMessageId: string;
};

const DecodeBranches = Schema.decodeUnknownOption(
  Schema.Struct({
    branches: Schema.Array(
      Schema.Struct({
        taskId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        ...OpenbotThreadBranchLink.fields,
      }),
    ),
  }),
);

export function decodeBotThreadBranches(value: unknown): readonly BotThreadBranch[] {
  const decoded = DecodeBranches(value);
  return decoded._tag === "Some" ? decoded.value.branches : [];
}

function hasAttachmentsOrMedia(message: OpenbotConversationMessage): boolean {
  const attachments = message.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) return true;
  if (message.imageGeneration != null || message.videoGeneration != null) return true;
  return false;
}

function isAssistantAuthor(author: OpenbotConversationMessage["author"]): boolean {
  return author === "assistant" || author === "agent";
}

function isBranchableMessage(message: OpenbotConversationMessage): boolean {
  if (!isAssistantAuthor(message.author) || message.status === "streaming") return false;
  if (
    message.itemType === "commentary" ||
    message.itemType === "plan" ||
    message.itemType === "subagents" ||
    message.itemType === "memory-changes"
  ) {
    return false;
  }
  if (message.questionPrompt != null || message.exchange != null || message.routine != null) {
    return false;
  }
  return message.text.trim().length > 0 || hasAttachmentsOrMedia(message);
}

function isQueuedOrCancelled(message: OpenbotConversationMessage): boolean {
  const delivery = message.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return false;
  const status = (delivery as Record<string, unknown>).status;
  return status === "queued" || status === "cancelled";
}

/**
 * Matches OpenBot's branch-point rule: the last finished assistant/agent answer in each completed
 * turn is eligible for "Branch here".
 */
export function botBranchPointIds(
  messages: readonly OpenbotConversationMessage[],
  activeTurnId: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  let candidate: OpenbotConversationMessage | undefined;
  let streamingAfter = false;
  const isOtherTurn = (message: OpenbotConversationMessage) =>
    candidate?.turnId !== undefined &&
    message.turnId !== undefined &&
    candidate.turnId !== message.turnId;

  for (const message of messages) {
    if (isQueuedOrCancelled(message)) continue;
    if (message.author === "user" || isOtherTurn(message)) {
      if (candidate) ids.add(candidate.id);
      candidate = undefined;
      streamingAfter = false;
    }
    if (message.author === "user") continue;
    if (isBranchableMessage(message)) {
      candidate = message;
      streamingAfter = false;
    } else if (message.status === "streaming") {
      streamingAfter = true;
    }
  }
  const ended = candidate?.turnId === undefined ? !activeTurnId : candidate.turnId !== activeTurnId;
  if (candidate && ended && !streamingAfter) ids.add(candidate.id);
  return ids;
}

/**
 * Finds the last rendered message at or before `throughMessageId` so the "Branched from" divider
 * appears right after the inherited history even when `throughMessageId` itself is a hidden item.
 */
export function botBranchDividerAfterId(
  messages: readonly OpenbotConversationMessage[],
  throughMessageId: string,
  isHidden?: (message: OpenbotConversationMessage) => boolean,
): string | null {
  const throughIndex = messages.findIndex((message) => message.id === throughMessageId);
  if (throughIndex < 0) return null;
  for (let index = throughIndex; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate && !isHidden?.(candidate)) return candidate.id;
  }
  return null;
}

export function botChildBranchesByMessage(
  branches: readonly BotThreadBranch[],
  currentTaskId: string | null,
): ReadonlyMap<string, readonly BotThreadBranch[]> {
  const map = new Map<string, BotThreadBranch[]>();
  for (const branch of branches) {
    if (branch.sourceTaskId !== currentTaskId) continue;
    const existing = map.get(branch.sourceMessageId);
    if (existing) existing.push(branch);
    else map.set(branch.sourceMessageId, [branch]);
  }
  return map;
}

export function botCanDeleteConversationMessage(
  message: Pick<OpenbotConversationMessage, "author" | "status" | "turnId">,
  activeTurnId: string | null,
): boolean {
  if (message.author === "system" || message.status === "streaming") return false;
  if (activeTurnId && message.turnId === activeTurnId) return false;
  return true;
}
