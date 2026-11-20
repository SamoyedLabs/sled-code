import { queueAttachmentRequestHash } from "./QueueAttachmentsIdentity.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
} from "@t3tools/contracts/openbot-queue-attachments";
import { OpenbotOriginalUploadIdentity, OpenbotFilesError } from "@t3tools/contracts";
const fail = () => new OpenbotFilesError({ operation: "send", reason: "conflict" });
const encodeBatch = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      attachmentIds: Schema.Array(Schema.String),
      expectedThreadId: Schema.String,
      queueEdit: QueueAttachmentEdit,
    }),
  ),
);
const decodeOwner = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      principal: Schema.String,
      environmentId: Schema.String,
      ...OpenbotOriginalUploadIdentity.fields,
    }),
  ),
);
const encodeAttachments = Schema.encodeEffect(
  Schema.fromJsonString(QueueAttachmentReceipt.fields.attachments),
);
/** Runs inside Files' existing gate. Reuses its draft rows, never an independent send worker. */
export const editQueueAttachments = Effect.fn("Files.editQueueAttachments")(function* <E>(
  sql: SqlClient.SqlClient,
  input: QueueAttachmentEdit,
  principal: string,
  resultOnly: boolean,
  ports: {
    authorize: () => Effect.Effect<void, E>;
    post: (resultOnly: boolean) => Effect.Effect<QueueAttachmentReceipt | null, E>;
  },
) {
  yield* ports.authorize();
  if (
    !input.uploads.length ||
    new Set(input.uploads.map((u) => u.draftId)).size !== input.uploads.length
  )
    return yield* fail();
  const batch = yield* encodeBatch({
    attachmentIds: input.uploads.map((u) => u.draftId),
    expectedThreadId: input.threadId,
    queueEdit: input,
  });
  const rows = yield* sql.withTransaction(
    Effect.gen(function* () {
      const found = [];
      for (const upload of input.uploads) {
        const rows = yield* sql<{
          state: string;
          upload_json: string | null;
          batch_json: string | null;
          sha256: string;
          committed_json: string | null;
        }>`SELECT state, upload_json, batch_json, sha256, committed_json FROM openbot_file_drafts WHERE host_id=${input.hostId} AND agent_id=${input.agentId} AND attachment_id=${upload.draftId}`;
        const row = rows[0];
        if (!row?.upload_json) return yield* fail();
        const owned = yield* decodeOwner(row.upload_json);
        if (
          owned.principal !== principal ||
          owned.environmentId !== input.environmentId ||
          Object.entries(upload.identity).some(
            ([key, value]) => owned[key as keyof typeof owned] !== value,
          ) ||
          row.sha256 !== upload.identity.sha256 ||
          upload.identity.hostId !== input.hostId ||
          upload.identity.agentId !== input.agentId ||
          upload.identity.threadId !== input.threadId ||
          upload.identity.taskId !== input.taskId
        )
          return yield* fail();
        if (row.batch_json !== null && row.batch_json !== batch) return yield* fail();
        if (row.batch_json === null && row.state !== "ready") return yield* fail();
        found.push(row);
      }
      if (!resultOnly && found.every((r) => r.batch_json === null)) {
        for (const upload of input.uploads)
          yield* sql`UPDATE openbot_file_drafts SET state='sending', batch_json=${batch}, send_text=${input.text}, client_message_id=${input.editId} WHERE host_id=${input.hostId} AND agent_id=${input.agentId} AND attachment_id=${upload.draftId}`;
        return { fresh: true };
      }
      if (found.some((r) => r.batch_json !== batch)) return yield* fail();
      return { fresh: false };
    }),
  );
  // A persisted attempt (including one interrupted before HTTP) is lookup-only forever.
  const receipt = yield* ports.post(resultOnly || !rows.fresh);
  if (receipt === null) return null;
  if (
    receipt.deliveryId !== input.deliveryId ||
    receipt.editId !== input.editId ||
    receipt.expectedRevision !== input.expectedRevision ||
    receipt.requestHash !== queueAttachmentRequestHash(input, principal)
  )
    return yield* fail();
  yield* ports.authorize();
  const committed = yield* encodeAttachments(receipt.attachments);
  yield* sql.withTransaction(
    Effect.forEach(
      input.uploads,
      (u) =>
        sql`UPDATE openbot_file_drafts SET state='sent', message_id=${receipt.messageId}, conversation_message_id=${receipt.deliveryId}, task_id=${input.taskId}, committed_json=${committed} WHERE host_id=${input.hostId} AND agent_id=${input.agentId} AND attachment_id=${u.draftId} AND batch_json=${batch}`,
      { discard: true },
    ),
  );
  return receipt;
});
