import { queueAttachmentRequestHash } from "./QueueAttachmentsIdentity.ts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Config from "../config.ts";
import { editQueueAttachments } from "./QueueAttachmentsJournal.ts";
it.live("uses existing Files rows atomically and never replays a persisted queue attempt", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const identity = {
      operationId: "upload",
      hostId: "host",
      agentId: "agent",
      threadId: "thread",
      taskId: null,
      name: "f.txt",
      mimeType: "text/plain",
      size: 1,
      sha256: "a".repeat(64),
    };
    const input = {
      environmentId: "env",
      hostId: "host",
      agentId: "agent",
      threadId: "thread",
      taskId: null,
      deliveryId: "delivery",
      editId: "edit",
      expectedRevision: "b".repeat(64),
      text: "changed",
      keepAttachmentIds: [],
      uploads: [{ identity, draftId: "draft" }],
    };
    const ownership = JSON.stringify({ ...identity, principal: "principal", environmentId: "env" });
    yield* sql`INSERT INTO openbot_file_drafts(host_id,agent_id,attachment_id,summary_json,sha256,state,client_message_id,upload_json) VALUES ('host','agent','draft','{}',${identity.sha256},'ready','original',${ownership})`;
    let saves = 0,
      lookups = 0;
    const receipt = {
      requestHash: queueAttachmentRequestHash(input, "principal"),
      deliveryId: "delivery",
      editId: "edit",
      expectedRevision: input.expectedRevision,
      messageId: "message",
      attachments: [],
    };
    const ports = {
      authorize: () => Effect.void,
      post: (lookup: boolean) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            state: string;
            batch_json: string;
          }>`SELECT state,batch_json FROM openbot_file_drafts`;
          expect(rows[0]!.batch_json).toContain("queueEdit");
          if (!lookup) {
            saves++;
            expect(rows[0]!.state).toBe("sending");
            return yield* Effect.fail("response lost");
          }
          lookups++;
          return receipt;
        }),
    };
    const denied = yield* Effect.result(editQueueAttachments(sql, input, "other", false, ports));
    expect(denied._tag).toBe("Failure");
    const lost = yield* Effect.result(editQueueAttachments(sql, input, "principal", false, ports));
    expect(lost._tag).toBe("Failure");
    // Recreate call state as after a Sled restart; SQLite reservation forces lookup.
    expect(yield* editQueueAttachments(sql, input, "principal", false, ports)).toEqual(receipt);
    expect(saves).toBe(1);
    expect(lookups).toBe(1);
    const changed = yield* Effect.result(
      editQueueAttachments(sql, { ...input, text: "different" }, "principal", true, ports),
    );
    expect(changed._tag).toBe("Failure");
    const rows = yield* sql<{ state: string }>`SELECT state FROM openbot_file_drafts`;
    expect(rows[0]!.state).toBe("sent");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Config.layerTest(process.cwd(), { prefix: "queue-files-" }),
        Sqlite.layerMemory,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
);
