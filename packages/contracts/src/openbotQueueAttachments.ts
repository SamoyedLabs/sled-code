import * as Schema from "effect/Schema";
import { OpenbotOriginalUploadIdentity, OpenbotFileSummary } from "./openbotFiles.ts";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const QueueAttachmentTarget = Schema.Struct({
  environmentId: Id,
  hostId: Id,
  agentId: Id,
  threadId: Id,
  taskId: Schema.NullOr(Id),
  deliveryId: Id,
  editId: Id,
});
export type QueueAttachmentTarget = typeof QueueAttachmentTarget.Type;
export const QueueAttachmentEdit = Schema.Struct({
  ...QueueAttachmentTarget.fields,
  expectedRevision: Hash,
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  keepAttachmentIds: Schema.Array(Id).check(Schema.isMaxLength(10)),
  uploads: Schema.Array(
    Schema.Struct({ identity: OpenbotOriginalUploadIdentity, draftId: Id }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
});
export type QueueAttachmentEdit = typeof QueueAttachmentEdit.Type;
export const QueueAttachmentReceipt = Schema.Struct({
  requestHash: Hash,
  deliveryId: Id,
  editId: Id,
  expectedRevision: Hash,
  messageId: Id,
  attachments: Schema.Array(OpenbotFileSummary).check(Schema.isMaxLength(10)),
});
export type QueueAttachmentReceipt = typeof QueueAttachmentReceipt.Type;
export const QUEUE_ATTACHMENTS_CAPABILITY = "sled-queue-attachments-v1";

export const QueueAttachmentContext = Schema.Struct({
  expectedRevision: Hash,
  text: Schema.String.check(Schema.isMaxLength(100000)),
  keepAttachmentIds: Schema.Array(Id).check(Schema.isMaxLength(10)),
});
export type QueueAttachmentContext = typeof QueueAttachmentContext.Type;
