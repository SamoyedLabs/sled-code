/** Shared identity for local and remote assignments. thread_id is the durable local receipt. */
export interface CodingRow {
  readonly host_id: string;
  readonly agent_id: string;
  readonly task_id: string;
  readonly operation_id: string;
  readonly project_id: string;
  readonly thread_id: string;
  readonly command_id: string;
  readonly input_json: string;
  readonly cancel_requested: number;
  readonly destination_environment_id: string | null;
  readonly remote_thread_id: string | null;
  readonly remote_authority_json: string | null;
  readonly remote_snapshot_json: string | null;
  readonly remote_settled: number;
  readonly remote_stop_pending: number;
  readonly remote_launch_attempted: number;
  readonly remote_stop_authority_json: string | null;
}
