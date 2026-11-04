import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN destination_environment_id TEXT`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_thread_id TEXT`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_authority_json TEXT`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_snapshot_json TEXT`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_settled INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_stop_pending INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE openbot_coding_tasks ADD COLUMN remote_launch_attempted INTEGER NOT NULL DEFAULT 0`;
});
