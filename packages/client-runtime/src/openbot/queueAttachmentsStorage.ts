import * as Schema from "effect/Schema";
import {
  QueueAttachmentTarget,
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
} from "@t3tools/contracts/openbot-queue-attachments";
import { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
import type { QueueAttachmentScope, QueueAttachmentState } from "./queueAttachments.ts";
const State = Schema.Struct({
  scope: Schema.Struct({ ...QueueAttachmentTarget.fields, principal: Schema.String }),
  edit: Schema.Struct({
    ...QueueAttachmentEdit.fields,
    uploads: Schema.Array(
      Schema.Struct({ identity: OpenbotOriginalUploadIdentity, draftId: Schema.String }),
    ).check(Schema.isMaxLength(10)),
  }),
  phase: Schema.Literals(["ready", "saving", "unknown", "saved", "cancelled"]),
  pendingUpload: Schema.NullOr(OpenbotOriginalUploadIdentity),
  receipt: Schema.NullOr(QueueAttachmentReceipt),
});
const decodeState = Schema.decodeSync(Schema.fromJsonString(State));
const decode = (raw: string) => decodeState(raw, { onExcessProperty: "error" });
/** Adapts existing web Storage / native AsyncStorage. Stores an attempt, never runs it on load. */
export function queueAttachmentStorage(
  scope: QueueAttachmentScope,
  storage: {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
  },
) {
  const key = `sled.queue-attachments.v1:${JSON.stringify([scope.principal, scope.environmentId, scope.hostId, scope.agentId, scope.threadId, scope.taskId, scope.deliveryId, scope.editId])}`;
  return {
    async read(): Promise<QueueAttachmentState | null> {
      const raw = await storage.getItem(key);
      if (raw === null) return null;
      const state = decode(raw);
      if (
        Object.keys(scope).some(
          (k) =>
            state.scope[k as keyof QueueAttachmentScope] !== scope[k as keyof QueueAttachmentScope],
        )
      )
        throw new Error("Queue edit scope changed");
      return state;
    },
    async persist(state: QueueAttachmentState) {
      const raw = JSON.stringify(state);
      decode(raw);
      await storage.setItem(key, raw);
    },
  };
}
export const QueueAttachmentStateSchema = State;
