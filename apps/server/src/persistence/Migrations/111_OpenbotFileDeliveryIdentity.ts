import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN conversation_message_id TEXT`;
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN committed_json TEXT`;
});
