CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  tunnel_name TEXT NOT NULL UNIQUE,
  tunnel_id TEXT,
  dns_id TEXT,
  origin_json TEXT NOT NULL,
  credential_hash TEXT,
  linked_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE environments ADD COLUMN hold_offline INTEGER NOT NULL DEFAULT 0;
CREATE INDEX environments_user ON environments(user_id, revoked);
CREATE TABLE nonces (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX nonces_expiry ON nonces(expires);
CREATE TABLE leases (id TEXT PRIMARY KEY, holder TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE held_hooks (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments(id),
  hook_id TEXT NOT NULL,
  token TEXT NOT NULL,
  method TEXT NOT NULL,
  query TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  body BLOB NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX held_hooks_environment ON held_hooks(environment_id, received_at);
