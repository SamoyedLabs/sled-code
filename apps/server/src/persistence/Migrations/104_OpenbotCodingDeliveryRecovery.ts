import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS openbot_coding_deliveries (
    thread_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL UNIQUE,
    accepted_at TEXT,
    PRIMARY KEY (thread_id, run_id)
  )`;
  yield* sql`ALTER TABLE openbot_coding_deliveries ADD COLUMN first_attempt_at TEXT`;
  yield* sql`ALTER TABLE openbot_coding_deliveries ADD COLUMN payload_text TEXT`;
  yield* sql`ALTER TABLE openbot_coding_deliveries ADD COLUMN reconciliation_required INTEGER NOT NULL DEFAULT 0`;
});
