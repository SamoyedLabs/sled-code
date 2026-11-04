import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE openbot_coding_tasks (
      host_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      command_id TEXT NOT NULL UNIQUE,
      input_json TEXT NOT NULL,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (host_id, agent_id, task_id, operation_id)
    )
  `;
  yield* sql`
    CREATE TABLE openbot_coding_deliveries (
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      client_message_id TEXT NOT NULL UNIQUE,
      accepted_at TEXT,
      PRIMARY KEY (thread_id, run_id)
    )
  `;
});
