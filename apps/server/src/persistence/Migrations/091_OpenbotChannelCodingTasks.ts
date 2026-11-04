import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_channel_coding_tasks (
    binding_key TEXT PRIMARY KEY,
    binding_json TEXT NOT NULL,
    origin_ref TEXT NOT NULL REFERENCES openbot_channel_origins(origin_ref),
    launch_hash TEXT NOT NULL,
    launch_json TEXT NOT NULL,
    authority_json TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE,
    command_id TEXT NOT NULL UNIQUE,
    environment_id TEXT,
    project_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('reserved','uncertain','accepted','terminal','delivered','stale','cancelled')),
    outcome_json TEXT,
    result_hash TEXT,
    receipt_json TEXT,
    created_at INTEGER NOT NULL
  )`;
  yield* sql`CREATE TRIGGER openbot_channel_task_immutable BEFORE UPDATE ON openbot_channel_coding_tasks
    WHEN NEW.binding_key != OLD.binding_key OR NEW.binding_json != OLD.binding_json
      OR NEW.origin_ref != OLD.origin_ref OR NEW.launch_hash != OLD.launch_hash
      OR NEW.launch_json != OLD.launch_json OR NEW.authority_json != OLD.authority_json
      OR NEW.thread_id != OLD.thread_id OR NEW.command_id != OLD.command_id
      OR NEW.environment_id IS NOT OLD.environment_id OR NEW.project_id != OLD.project_id
      OR NEW.created_at != OLD.created_at
      OR (OLD.outcome_json IS NOT NULL AND NEW.outcome_json IS NOT OLD.outcome_json)
      OR (OLD.receipt_json IS NOT NULL AND NEW.receipt_json IS NOT OLD.receipt_json)
    BEGIN SELECT RAISE(ABORT, 'immutable channel coding task'); END`;
});
