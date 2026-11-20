// @effect-diagnostics nodeBuiltinImport:off -- Reads the retained engine's SQLite authority without owning its connection.
import type * as NodeSqlite from "node:sqlite";

/** The retained parent independently verifies the exact engine mapping and outstanding attempt. */
export function validateUpstreamCommitOwnership(
  db: NodeSqlite.DatabaseSync,
  agentId: string,
  threadId: string,
  nonce: string,
  incarnation: string,
): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM privileged_response_ownership p JOIN projection_threads t ON t.thread_id=p.thread_id
   JOIN projection_agents a ON a.agent_id=t.agent_id WHERE p.nonce=? AND p.incarnation=? AND p.state='outstanding'
   AND p.agent_id=? AND p.thread_id=? AND t.agent_id=p.agent_id AND
   (a.thread_id=t.thread_id OR EXISTS(SELECT 1 FROM projection_agent_threads x WHERE x.thread_id=t.thread_id AND x.agent_id=t.agent_id) OR EXISTS(
      SELECT 1 FROM projection_channel_contexts c JOIN projection_channels g ON g.channel_id=c.channel_id
      WHERE c.thread_id=t.thread_id AND c.agent_id=t.agent_id AND json_extract(g.channel_json,'$.archived')=0
      AND EXISTS(SELECT 1 FROM json_each(g.channel_json,'$.members') m WHERE json_extract(m.value,'$.agentId')=t.agent_id)))
`)
      .get(nonce, incarnation, agentId, threadId),
  );
}
