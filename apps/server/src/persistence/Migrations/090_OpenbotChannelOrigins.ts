import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE openbot_channel_origins (
    origin_ref TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    authority_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('prepared','uncertain','accepted','revoked')),
    message_id TEXT,
    receipt_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(host_id, channel_id, operation_id),
    UNIQUE(host_id, channel_id, message_id),
    CHECK((message_id IS NULL) = (receipt_id IS NULL)),
    CHECK(state != 'accepted' OR message_id IS NOT NULL)
  )`;
  yield* sql`CREATE TRIGGER openbot_channel_origin_immutable BEFORE UPDATE ON openbot_channel_origins
    WHEN NEW.origin_ref != OLD.origin_ref OR NEW.host_id != OLD.host_id
      OR NEW.fingerprint != OLD.fingerprint OR NEW.channel_id != OLD.channel_id
      OR NEW.operation_id != OLD.operation_id OR NEW.payload_hash != OLD.payload_hash
      OR NEW.authority_json != OLD.authority_json OR NEW.created_at != OLD.created_at
      OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.receipt_id IS NOT OLD.receipt_id))
      OR (OLD.state = 'revoked' AND NEW.state != 'revoked')
    BEGIN SELECT RAISE(ABORT, 'immutable channel origin'); END`;
});
