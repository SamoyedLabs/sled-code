import type { OpenbotDraftFile, OpenbotFileScope, OpenbotFileTarget } from "@t3tools/contracts";
import {
  normalizeConversationUiBlock,
  isSecretFormField,
  uiBlockActionIsPrivileged,
} from "@t3tools/contracts/openbot-ui-blocks";
export { blockAnswers, type BlockCommand } from "@t3tools/contracts/openbot-ui-block-answer";
function sameTarget(a: OpenbotFileTarget | null, b: OpenbotFileTarget): boolean {
  return (
    a !== null &&
    a.kind === b.kind &&
    (a.kind !== "task" || (b.kind === "task" && a.taskId === b.taskId)) &&
    (a.kind !== "channel" || (b.kind === "channel" && a.channelId === b.channelId))
  );
}
export function selectableDraft(
  scope: OpenbotFileScope,
  target: OpenbotFileTarget,
  draft: OpenbotDraftFile,
) {
  return (
    draft.hostId === scope.hostId &&
    draft.agentId === scope.agentId &&
    (draft.state === "ready" || draft.state === "sending") &&
    (draft.target === null || sameTarget(draft.target, target))
  );
}
export function acceptedDraft(
  scope: OpenbotFileScope,
  target: OpenbotFileTarget,
  attachmentId: string,
  value: OpenbotDraftFile,
) {
  return (
    value.hostId === scope.hostId &&
    value.agentId === scope.agentId &&
    value.attachment.id === attachmentId &&
    value.state === "sent" &&
    value.messageId !== null &&
    (target.kind !== "task" || value.taskId === target.taskId) &&
    (target.kind !== "main" || value.taskId === null) &&
    sameTarget(value.target, target)
  );
}
export { normalizeConversationUiBlock, uiBlockActionIsPrivileged };

export function blockInitialValues(value: unknown): Record<string, string | string[]> {
  const block = normalizeConversationUiBlock(value);
  if (!block) return {};
  const spec = block.spec;
  if (spec.type === "choice")
    return { selected: spec.options.filter((o) => o.selected).map((o) => o.id) };
  if (spec.type === "form")
    return Object.fromEntries(
      spec.fields.flatMap((f) => (f.value === undefined ? [] : [[f.id, f.value]])),
    );
  if (spec.type === "confirm")
    return Object.fromEntries(
      (spec.fields ?? []).flatMap((f) => ("select" in f ? [[f.select, f.options[0] ?? ""]] : [])),
    );
  return {};
}

export function blockValuesAfterAttempt(
  value: unknown,
  values: Record<string, string | string[]>,
  accepted: boolean,
): Record<string, string | string[]> {
  if (accepted) return {};
  const block = normalizeConversationUiBlock(value);
  if (!block) return {};
  if (block.spec.type !== "form") return values;
  const privateIds = new Set(block.spec.fields.filter(isSecretFormField).map((field) => field.id));
  return Object.fromEntries(Object.entries(values).filter(([id]) => !privateIds.has(id)));
}
