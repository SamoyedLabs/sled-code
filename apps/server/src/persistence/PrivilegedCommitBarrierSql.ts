// Shared by the migration and the dedicated SQLite adapter; no runtime schema creation.
export const privilegedCommitBarrierSql = [
  `CREATE TABLE privileged_commit_closed (principal TEXT PRIMARY KEY)`,
  `CREATE TABLE privileged_commit_children (
    incarnation TEXT PRIMARY KEY, environment TEXT NOT NULL, host TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('alive','exited')))`,
  `CREATE TABLE privileged_commit_grants (
    permit TEXT PRIMARY KEY, principal TEXT NOT NULL, incarnation TEXT NOT NULL,
    nonce TEXT NOT NULL, identity TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('outstanding','finished','exited')),
    UNIQUE(incarnation, nonce))`,
  `CREATE INDEX privileged_commit_outstanding ON privileged_commit_grants(principal,state)`,
  `CREATE TRIGGER privileged_session_update BEFORE UPDATE OF
    session_id,subject,scopes,method,issued_at,expires_at,revoked_at ON auth_sessions
    WHEN EXISTS (SELECT 1 FROM privileged_commit_grants
      WHERE principal=OLD.session_id AND state='outstanding')
    BEGIN SELECT RAISE(ABORT,'Privileged commit drain required'); END`,
  `CREATE TRIGGER privileged_session_delete BEFORE DELETE ON auth_sessions
    WHEN EXISTS (SELECT 1 FROM privileged_commit_grants
      WHERE principal=OLD.session_id AND state='outstanding')
    BEGIN SELECT RAISE(ABORT,'Privileged commit drain required'); END`,
  // REPLACE can delete without firing delete triggers when recursive_triggers is off.
  `CREATE TRIGGER privileged_session_replace BEFORE INSERT ON auth_sessions
    WHEN EXISTS (SELECT 1 FROM privileged_commit_grants
      WHERE principal=NEW.session_id AND state='outstanding')
    BEGIN SELECT RAISE(ABORT,'Privileged commit drain required'); END`,
] as const;
