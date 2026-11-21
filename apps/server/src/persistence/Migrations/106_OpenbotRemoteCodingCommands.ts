import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_stop_authority_json TEXT`;
  yield* sql`CREATE TABLE openbot_remote_coding_sends (
    receipt_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    text TEXT NOT NULL,
    authority_json TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (receipt_id, command_id)
  )`;
});
