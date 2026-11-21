import type { OpenbotConversationMessage, OpenbotConversationPage } from "@t3tools/contracts";
import { m as i18nMessage } from "../../../../i18n/messages";
import { msg } from "gt-react";
export interface AssistantAttempt {
  clientMessageId: string;
  deliveryId: string;
  messageId: string;
}
export type AssistantResolution =
  | { kind: "waiting" }
  | { kind: "failed"; error: string }
  | { kind: "complete"; answer: OpenbotConversationMessage | null };
const excluded = new Set([
  "commentary",
  "question_prompt",
  "plan",
  "subagents",
  "routine_quiet_answer",
]);
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export function assistantReceipt(
  value: unknown,
  agentId: string,
  clientMessageId: string,
): AssistantAttempt | null {
  const r = record(value);
  const rows = r?.deliveries;
  if (!Array.isArray(rows)) return null;
  for (const value of rows) {
    const row = record(value);
    if (row?.recipientAgentId === agentId && typeof row.id === "string" && row.id)
      return {
        clientMessageId,
        deliveryId: row.id,
        messageId: typeof row.messageId === "string" ? row.messageId : row.id,
      };
  }
  return null;
}
/** Resolve only the request's own turn; a queued request never borrows another turn's answer. */
export function resolveRoutineAssistant(
  attempt: AssistantAttempt,
  around: OpenbotConversationPage | null,
  latest: OpenbotConversationPage | null,
): AssistantResolution {
  const matches = (m: OpenbotConversationMessage) =>
    m.id === attempt.messageId ||
    m.id === attempt.deliveryId ||
    record(m.delivery)?.id === attempt.deliveryId ||
    m.clientMessageId === attempt.clientMessageId;
  const page = [latest, around].find((p) => p?.messages.some(matches));
  const asked = page?.messages.find(matches);
  if (!asked || !page) return { kind: "waiting" };
  const delivery = record(asked.delivery);
  const status =
    typeof delivery?.status === "string" ? delivery.status : asked.turnId ? "completed" : "queued";
  if (["failed", "cancelled", "interrupted"].includes(status))
    return {
      kind: "failed",
      error: i18nMessage(
        msg("The canvas request was {status}. Open the agent conversation for details.", {
          status,
        }),
      ),
    };
  if (status === "queued" || !asked.turnId || page.activeTurnId === asked.turnId)
    return { kind: "waiting" };
  if (status !== "completed") return { kind: "waiting" };
  if (!latest || latest.threadId !== page.threadId || latest.revision < page.revision)
    return { kind: "waiting" };
  const messages = [...page.messages, ...latest.messages];
  const answer =
    messages
      .reverse()
      .find(
        (m) =>
          m.turnId === asked.turnId &&
          (m.author === "assistant" || m.author === "agent") &&
          m.status === "completed" &&
          !excluded.has(m.itemType ?? "") &&
          (m.text.trim() || m.deferredFields?.includes("text")),
      ) ?? null;
  return { kind: "complete", answer };
}
