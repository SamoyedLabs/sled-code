import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // All drafts of one message share the same exact ordered payload and upstream receipt identity.
  // This remains nullable for already-journaled single-file sends from earlier versions.
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN batch_json TEXT`;
});
