import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN target_json TEXT`;
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN task_id TEXT`;
  // Sends made before target selection existed belonged to the main conversation.
  yield* sql`UPDATE openbot_file_drafts SET target_json = '{"kind":"main"}' WHERE state <> 'ready'`;
});
