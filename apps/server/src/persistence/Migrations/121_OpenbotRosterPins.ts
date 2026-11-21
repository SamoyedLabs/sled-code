import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE openbot_roster_pins (
      host_id TEXT NOT NULL,
      principal TEXT NOT NULL,
      items TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (host_id, principal)
    )
  `;
});
