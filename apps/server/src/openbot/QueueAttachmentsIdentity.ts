// @effect-diagnostics nodeBuiltinImport:off -- Exact released producer receipt identity.
import * as NodeCrypto from "node:crypto";
import type { QueueAttachmentEdit } from "@t3tools/contracts/openbot-queue-attachments";
export function queueAttachmentRequestHash(input: QueueAttachmentEdit, principal: string): string {
  return NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify([
        principal,
        input.environmentId,
        input.hostId,
        input.agentId,
        input.threadId,
        input.taskId,
        input.deliveryId,
        input.editId,
        input.expectedRevision,
        input.text,
        input.keepAttachmentIds,
        input.uploads.map((u) => [
          u.draftId,
          u.identity.operationId,
          u.identity.name,
          u.identity.mimeType,
          u.identity.size,
          u.identity.sha256,
          principal,
          input.environmentId,
          u.identity.hostId,
          u.identity.agentId,
          u.identity.threadId,
          u.identity.taskId,
        ]),
      ]),
    )
    .digest("hex");
}
