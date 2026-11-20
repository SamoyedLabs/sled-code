import type { DurablePrivilegedCommitAuthority } from "./DurablePrivilegedCommitAuthority.ts";
import type { QueueCommitEffect } from "./QueueCommitIdentity.ts";
type Channel = ReturnType<DurablePrivilegedCommitAuthority["bindChild"]>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();

export function handleQueueCommitFrame(value: unknown, channel: Channel) {
  if (!record(value) || !["queue-acquire", "queue-finish"].includes(String(value.operation)))
    return null;
  const finish = value.operation === "queue-finish";
  if (
    !exact(
      value,
      finish
        ? ["id", "operation", "principal", "effect", "permit"]
        : ["id", "operation", "principal", "effect"],
    ) ||
    !id(value.id) ||
    !id(value.principal) ||
    (finish && !id(value.permit)) ||
    !record(value.effect)
  )
    throw new Error("Privileged commit unavailable");
  const effect = value.effect;
  if (
    !exact(effect, [
      "purpose",
      "agentId",
      "threadId",
      "taskId",
      "deliveryId",
      "editId",
      "expectedRevision",
      "requestHash",
    ]) ||
    effect.purpose !== "queue-attachments" ||
    !id(effect.agentId) ||
    !id(effect.threadId) ||
    !(effect.taskId === null || id(effect.taskId)) ||
    !id(effect.deliveryId) ||
    !id(effect.editId) ||
    !hash(effect.expectedRevision) ||
    !hash(effect.requestHash)
  )
    throw new Error("Privileged commit unavailable");
  const decoded: QueueCommitEffect = {
    purpose: "queue-attachments",
    agentId: effect.agentId,
    threadId: effect.threadId,
    taskId: effect.taskId,
    deliveryId: effect.deliveryId,
    editId: effect.editId,
    expectedRevision: effect.expectedRevision,
    requestHash: effect.requestHash,
  };
  try {
    const input = { principal: value.principal, effect: decoded };
    if (finish) {
      channel.finishQueue(String(value.permit), input);
      return { id: value.id, ok: true };
    }
    const permit = channel.acquireQueue(input);
    return { id: value.id, ok: true, permit, deadline: channel.deadline(permit) };
  } catch {
    return { id: value.id, ok: false };
  }
}
