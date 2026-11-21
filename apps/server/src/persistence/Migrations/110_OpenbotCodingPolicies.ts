import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_coding_policies (
    host_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL, config_json TEXT, managed_block TEXT, pending_json TEXT,
    PRIMARY KEY (host_id, agent_id)
  )`;
});
