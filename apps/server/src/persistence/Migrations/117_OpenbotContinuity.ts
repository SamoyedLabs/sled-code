import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_attention_recipients (session_id TEXT PRIMARY KEY, cloud_user_id TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL)`;
  yield* sql`CREATE TABLE openbot_attention_outbox (event_id TEXT NOT NULL, session_id TEXT NOT NULL, payload_json TEXT NOT NULL, authority_json TEXT, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, delivered_at TEXT, PRIMARY KEY(event_id,session_id))`;
  yield* sql`CREATE INDEX openbot_attention_pending ON openbot_attention_outbox(state,created_at)`;
  yield* sql`CREATE TABLE openbot_compatibility_runs (id TEXT PRIMARY KEY, identity_json TEXT NOT NULL, state TEXT NOT NULL, evidence_json TEXT, created_at TEXT NOT NULL, completed_at TEXT)`;
});
