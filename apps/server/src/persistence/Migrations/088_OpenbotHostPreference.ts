import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_host_preference (id INTEGER PRIMARY KEY CHECK(id=1), desired_running INTEGER NOT NULL CHECK(desired_running IN (0,1)))`;
});
