export interface QueueCommitEffect {
  readonly purpose: "queue-attachments";
  readonly agentId: string;
  readonly threadId: string;
  readonly taskId: string | null;
  readonly deliveryId: string;
  readonly editId: string;
  readonly expectedRevision: string;
  readonly requestHash: string;
}
export interface QueueCommitIdentity {
  readonly principal: string;
  readonly environmentId: string;
  readonly hostId: string;
  readonly engineIncarnation: string;
  readonly effect: QueueCommitEffect;
}
export const queueCommitKey = (identity: QueueCommitIdentity): string =>
  JSON.stringify([
    identity.effect.purpose,
    identity.principal,
    identity.environmentId,
    identity.hostId,
    identity.engineIncarnation,
    identity.effect.agentId,
    identity.effect.threadId,
    identity.effect.taskId,
    identity.effect.deliveryId,
    identity.effect.editId,
    identity.effect.expectedRevision,
    identity.effect.requestHash,
  ]);
