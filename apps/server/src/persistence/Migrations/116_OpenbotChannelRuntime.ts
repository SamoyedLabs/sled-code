import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_channel_grants (id TEXT PRIMARY KEY,host_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
   agent_id TEXT NOT NULL,channel_id TEXT NOT NULL,requester_kind TEXT NOT NULL CHECK(requester_kind IN ('routine','agent')),
   requester_id TEXT NOT NULL,owner_session TEXT NOT NULL,authority_json TEXT NOT NULL,defaults_json TEXT NOT NULL,
   expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`;
  yield* sql`DROP TRIGGER openbot_channel_task_immutable`;
  yield* sql`ALTER TABLE openbot_channel_coding_tasks RENAME TO openbot_channel_coding_tasks_legacy`;
  yield* sql`CREATE TABLE openbot_channel_coding_tasks (
   binding_key TEXT PRIMARY KEY,binding_json TEXT NOT NULL,origin_ref TEXT REFERENCES openbot_channel_origins(origin_ref),
   grant_id TEXT REFERENCES openbot_channel_grants(id),host_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
   launch_hash TEXT NOT NULL,launch_json TEXT NOT NULL,authority_json TEXT NOT NULL,thread_id TEXT NOT NULL UNIQUE,
   command_id TEXT NOT NULL UNIQUE,environment_id TEXT,project_id TEXT NOT NULL,
   state TEXT NOT NULL CHECK(state IN ('reserved','uncertain','accepted','terminal','delivered','stale','cancelled')),
   outcome_json TEXT,result_hash TEXT,receipt_json TEXT,created_at INTEGER NOT NULL,
   CHECK ((origin_ref IS NULL) != (grant_id IS NULL)))`;
  yield* sql`INSERT INTO openbot_channel_coding_tasks SELECT t.binding_key,t.binding_json,t.origin_ref,NULL,o.host_id,o.fingerprint,
   t.launch_hash,t.launch_json,t.authority_json,t.thread_id,t.command_id,t.environment_id,t.project_id,t.state,
   t.outcome_json,t.result_hash,t.receipt_json,t.created_at FROM openbot_channel_coding_tasks_legacy t
   JOIN openbot_channel_origins o ON o.origin_ref=t.origin_ref`;
  yield* sql`DROP TABLE openbot_channel_coding_tasks_legacy`;
  yield* sql`ALTER TABLE openbot_channel_coding_tasks ADD COLUMN remote_linked_at TEXT`;
  yield* sql`ALTER TABLE openbot_channel_coding_tasks ADD COLUMN remote_thread_id TEXT`;
  yield* sql`CREATE TRIGGER openbot_channel_task_immutable BEFORE UPDATE ON openbot_channel_coding_tasks
   WHEN NEW.binding_key != OLD.binding_key OR NEW.binding_json != OLD.binding_json OR NEW.origin_ref IS NOT OLD.origin_ref
   OR NEW.grant_id IS NOT OLD.grant_id OR NEW.host_id != OLD.host_id OR NEW.fingerprint != OLD.fingerprint
   OR NEW.launch_hash != OLD.launch_hash OR NEW.launch_json != OLD.launch_json OR NEW.authority_json != OLD.authority_json
   OR NEW.thread_id != OLD.thread_id OR NEW.command_id != OLD.command_id OR NEW.environment_id IS NOT OLD.environment_id
   OR NEW.project_id != OLD.project_id OR NEW.created_at != OLD.created_at
   OR (OLD.remote_linked_at IS NOT NULL AND NEW.remote_linked_at IS NOT OLD.remote_linked_at)
   OR (OLD.remote_thread_id IS NOT NULL AND NEW.remote_thread_id IS NOT OLD.remote_thread_id)
   OR (OLD.outcome_json IS NOT NULL AND NEW.outcome_json IS NOT OLD.outcome_json)
   OR (OLD.receipt_json IS NOT NULL AND NEW.receipt_json IS NOT OLD.receipt_json)
   BEGIN SELECT RAISE(ABORT,'immutable channel coding task'); END`;
});
