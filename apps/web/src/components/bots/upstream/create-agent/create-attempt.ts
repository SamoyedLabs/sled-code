import type { FirstAgentDraft } from "./agent-draft";
export type CreateAttempt = { draft: FirstAgentDraft; agentId: string | null };
// The source create endpoint has no operation ID. Keep an uncertain send on its exact retained session, without persisting profile text to disk.
const attempts = new WeakMap<object, Map<string, CreateAttempt>>();
export function retainedCreateAttempt(session: object, scope: string) {
  return attempts.get(session)?.get(scope) ?? null;
}
export function retainCreateAttempt(session: object, scope: string, attempt: CreateAttempt) {
  let scoped = attempts.get(session);
  if (!scoped) {
    scoped = new Map();
    attempts.set(session, scoped);
  }
  scoped.set(scope, attempt);
}
export function clearCreateAttempt(session: object, scope: string) {
  attempts.get(session)?.delete(scope);
}
