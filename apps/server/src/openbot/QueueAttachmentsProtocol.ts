import { queueAttachmentRequestHash } from "./QueueAttachmentsIdentity.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  QueueAttachmentContext,
  QueueAttachmentTarget,
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
  QUEUE_ATTACHMENTS_CAPABILITY,
} from "@t3tools/contracts/openbot-queue-attachments";
export class QueueAttachmentsUnavailable extends Schema.TaggedError<QueueAttachmentsUnavailable>()(
  "QueueAttachmentsUnavailable",
  {},
) {}
const decodeEdit = Schema.decodeOption(QueueAttachmentEdit);
const encodeEdit = Schema.encodeEffect(Schema.fromJsonString(QueueAttachmentEdit));
const decodeReceipt = Schema.decodeUnknownOption(QueueAttachmentReceipt);
const encodeTarget = Schema.encodeEffect(Schema.fromJsonString(QueueAttachmentTarget));
const decodeContext = Schema.decodeUnknownOption(QueueAttachmentContext);
/** Transport signs precisely this body using the dedicated queue binding; there is no queue.save fallback. */
export const dispatch = Effect.fn("QueueAttachments.dispatch")(function* <E>(
  input: QueueAttachmentEdit,
  resultOnly: boolean,
  ports: {
    principal: string;
    capabilities: ReadonlySet<string>;
    authorize: () => Effect.Effect<void, E>;
    post: (path: string, body: string) => Effect.Effect<unknown, E>;
  },
) {
  if (!ports.capabilities.has(QUEUE_ATTACHMENTS_CAPABILITY))
    return yield* new QueueAttachmentsUnavailable({});
  const request = decodeEdit(input, { onExcessProperty: "error" });
  if (request._tag === "None") return yield* new QueueAttachmentsUnavailable({});
  yield* ports.authorize().pipe(Effect.mapError(() => new QueueAttachmentsUnavailable({})));
  const body = yield* encodeEdit(request.value).pipe(
    Effect.mapError(() => new QueueAttachmentsUnavailable({})),
  );
  const raw = yield* ports.post(`/v1/sled/queue-attachments/${resultOnly ? "result" : "save"}`, body);
  if (raw === null && resultOnly) return null;
  const receipt = decodeReceipt(raw);
  if (
    receipt._tag === "None" ||
    receipt.value.deliveryId !== input.deliveryId ||
    receipt.value.editId !== input.editId ||
    receipt.value.expectedRevision !== input.expectedRevision ||
    receipt.value.requestHash !== queueAttachmentRequestHash(input, ports.principal)
  )
    return yield* new QueueAttachmentsUnavailable({});
  return receipt.value;
});

export const context = Effect.fn("QueueAttachments.context")(function* <E>(
  input: import("@t3tools/contracts/openbot-queue-attachments").QueueAttachmentTarget,
  ports: {
    capabilities: ReadonlySet<string>;
    authorize: () => Effect.Effect<void, E>;
    post: (path: string, body: string) => Effect.Effect<unknown, E>;
  },
) {
  if (!ports.capabilities.has(QUEUE_ATTACHMENTS_CAPABILITY))
    return yield* new QueueAttachmentsUnavailable({});
  yield* ports.authorize().pipe(Effect.mapError(() => new QueueAttachmentsUnavailable({})));
  const body = yield* encodeTarget(input).pipe(
    Effect.mapError(() => new QueueAttachmentsUnavailable({})),
  );
  const raw = yield* ports.post("/v1/sled/queue-attachments/context", body);
  const result = decodeContext(raw);
  if (result._tag === "None") return yield* new QueueAttachmentsUnavailable({});
  return result.value;
});
