import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_file_drafts (
    host_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ready',
    send_text TEXT,
    client_message_id TEXT NOT NULL,
    first_attempt_at TEXT,
    message_id TEXT,
    PRIMARY KEY (host_id,agent_id,attachment_id)
  )`;
});
