import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE openbot_file_drafts ADD COLUMN upload_json TEXT`;
  yield* sql`CREATE UNIQUE INDEX openbot_file_original_upload_id ON openbot_file_drafts (json_extract(upload_json, '$.operationId')) WHERE upload_json IS NOT NULL`;
});
