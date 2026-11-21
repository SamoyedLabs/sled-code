// @effect-diagnostics nodeBuiltinImport:off -- dedicated synchronous SQLite/process adapter.
import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "node:crypto";
import type * as NodeChildProcess from "node:child_process";
import type { PrivilegedCommitIdentity } from "./PrivilegedResponseCommitAuthority.ts";

import {
  queueCommitKey,
  type QueueCommitIdentity,
  type QueueCommitEffect,
} from "./QueueCommitIdentity.ts";

const unavailable = () => new Error("Privileged commit unavailable");
const targetKeys = ["agentId", "threadId", "turnId", "messageId", "blockId", "requestId"] as const;
function canonical(identity: PrivilegedCommitIdentity): string {
  return JSON.stringify([
    "privileged-response",
    identity.principal,
    identity.environmentId,
    identity.hostId,
    identity.engineIncarnation,
    identity.nonce,
    ...targetKeys.map((key) => identity.target[key]),
  ]);
}

/** The process adapter owns this connection. No route may attest child exit or erase grants. */
export class DurablePrivilegedCommitAuthority {
  readonly #db: NodeSqlite.DatabaseSync;
  readonly #children = new Map<string, { fence(): Promise<void> }>();
  readonly #validateTarget: (identity: PrivilegedCommitIdentity) => boolean;
  readonly #validateQueue: ((identity: QueueCommitIdentity) => boolean) | undefined;
  constructor(
    filename: string,
    validateTarget: (identity: PrivilegedCommitIdentity) => boolean,
    validateQueue?: (identity: QueueCommitIdentity) => boolean,
  ) {
    this.#validateQueue = validateQueue;
    this.#db = new NodeSqlite.DatabaseSync(filename);
    this.#db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
    this.#validateTarget = validateTarget;
  }
  // A supervisor calls this while it retains the exact handles. A reopened connection
  // can request draining, but cannot manufacture exit evidence for another owner.
  async drainInvalidated(): Promise<{ pending: number }> {
    const rows = this.#db
      .prepare(`SELECT DISTINCT g.incarnation FROM privileged_commit_grants g
      LEFT JOIN auth_sessions s ON s.session_id=g.principal
      WHERE g.state='outstanding' AND (s.session_id IS NULL OR s.revoked_at IS NOT NULL
      OR julianday(s.expires_at)<=julianday('now')
      OR EXISTS (SELECT 1 FROM privileged_commit_closed c WHERE c.principal=g.principal))`)
      .all();
    await Promise.all(
      rows.map(async (row) => {
        if (typeof row.incarnation === "string") await this.#children.get(row.incarnation)?.fence();
      }),
    );
    return {
      pending: Number(
        this.#db
          .prepare("SELECT count(*) n FROM privileged_commit_grants WHERE state='outstanding'")
          .get()?.n,
      ),
    };
  }

  deadline(permit: string): number {
    const row = this.#db
      .prepare(`SELECT s.expires_at FROM auth_sessions s
      JOIN privileged_commit_grants g ON g.principal=s.session_id
      WHERE g.permit=? AND g.state='outstanding'`)
      .get(permit);
    const deadline = typeof row?.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
    if (!Number.isFinite(deadline)) throw unavailable();
    return deadline;
  }

  close(): void {
    this.#db.close();
  }

  #transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.#db.exec("COMMIT");
      return result;
    } catch {
      this.#db.exec("ROLLBACK");
      throw unavailable();
    }
  }

  /** Only a newly spawned, retained ChildProcess handle is accepted, never an adopted PID. */
  bindChild(child: NodeChildProcess.ChildProcess, environmentId: string, hostId: string) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw unavailable();
    const incarnation = NodeCrypto.randomUUID();
    this.#transaction(() => {
      if (
        this.#db
          .prepare(`SELECT 1 FROM privileged_commit_children
        WHERE environment=? AND host=? AND state='alive'`)
          .get(environmentId, hostId)
      )
        throw unavailable();
      this.#db
        .prepare("INSERT INTO privileged_commit_children VALUES (?,?,?,'alive')")
        .run(incarnation, environmentId, hostId);
    });
    let exited = false;
    const exit = new Promise<void>((resolve, reject) => {
      child.once("exit", () => {
        exited = true;
        try {
          this.#transaction(() => {
            this.#db
              .prepare("UPDATE privileged_commit_children SET state='exited' WHERE incarnation=?")
              .run(incarnation);
            this.#db
              .prepare(`UPDATE privileged_commit_grants SET state='exited'
              WHERE incarnation=? AND state='outstanding'`)
              .run(incarnation);
          });
          resolve();
        } catch {
          reject(unavailable());
        }
      });
    });
    // Exit persistence failure must remain blocked, including when nobody is awaiting fence.
    void exit.catch(() => {});
    const identityFor = (
      input: Pick<PrivilegedCommitIdentity, "principal" | "nonce" | "target">,
    ) => ({
      principal: input.principal,
      nonce: input.nonce,
      target: input.target,
      environmentId,
      hostId,
      engineIncarnation: incarnation,
    });
    const channel = {
      activationReady: () => {
        this.#db.prepare("SELECT 1 FROM auth_sessions LIMIT 0").get();
        this.#db.prepare("SELECT 1 FROM privileged_commit_grants LIMIT 0").get();
        this.#db.prepare("SELECT 1 FROM privileged_commit_closed LIMIT 0").get();
        return (
          !exited &&
          this.#db
            .prepare(
              "SELECT 1 FROM privileged_commit_children WHERE incarnation=? AND state='alive'",
            )
            .get(incarnation) !== undefined
        );
      },
      incarnation,
      deadline: (permit: string) => this.deadline(permit),
      acquire: (
        input: Pick<PrivilegedCommitIdentity, "principal" | "nonce" | "target">,
      ): string => {
        const identity = identityFor(input);
        return this.#transaction(() => {
          if (exited || !this.#validateTarget(identity)) throw unavailable();
          const row = this.#db
            .prepare(`SELECT scopes FROM auth_sessions
            WHERE session_id=? AND revoked_at IS NULL AND julianday(expires_at)>julianday('now')
            AND NOT EXISTS (SELECT 1 FROM privileged_commit_closed WHERE principal=session_id)`)
            .get(identity.principal);
          if (!row || typeof row.scopes !== "string") throw unavailable();
          const scopes: unknown = JSON.parse(row.scopes);
          if (
            !Array.isArray(scopes) ||
            !["orchestration:operate", "settings:write"].every((s) => scopes.includes(s))
          )
            throw unavailable();
          const permit = NodeCrypto.randomUUID();
          this.#db
            .prepare(`INSERT INTO privileged_commit_grants VALUES (?,?,?,?,?,'outstanding')`)
            .run(permit, identity.principal, incarnation, identity.nonce, canonical(identity));
          return permit;
        });
      },
      acquireQueue: (input: { principal: string; effect: QueueCommitEffect }): string => {
        const identity = { ...input, environmentId, hostId, engineIncarnation: incarnation };
        return this.#transaction(() => {
          if (exited || !this.#validateQueue?.(identity)) throw unavailable();
          const row = this.#db
            .prepare(`SELECT scopes FROM auth_sessions WHERE session_id=?
            AND revoked_at IS NULL AND julianday(expires_at)>julianday('now')
            AND NOT EXISTS(SELECT 1 FROM privileged_commit_closed WHERE principal=session_id)`)
            .get(input.principal);
          if (!row || typeof row.scopes !== "string") throw unavailable();
          const scopes: unknown = JSON.parse(row.scopes);
          if (!Array.isArray(scopes) || !scopes.includes("orchestration:operate"))
            throw unavailable();
          const permit = NodeCrypto.randomUUID();
          this.#db
            .prepare("INSERT INTO privileged_commit_grants VALUES (?,?,?,?,?,'outstanding')")
            .run(
              permit,
              input.principal,
              incarnation,
              JSON.stringify(["queue-attachments", input.effect.editId]),
              queueCommitKey(identity),
            );
          return permit;
        });
      },
      finishQueue: (
        permit: string,
        input: { principal: string; effect: QueueCommitEffect },
      ): void => {
        const identity = { ...input, environmentId, hostId, engineIncarnation: incarnation };
        this.#transaction(() => {
          const result = this.#db
            .prepare(`UPDATE privileged_commit_grants SET state='finished'
            WHERE permit=? AND identity=? AND state='outstanding'`)
            .run(permit, queueCommitKey(identity));
          if (result.changes !== 1) throw unavailable();
        });
      },
      finish: (
        permit: string,
        input: Pick<PrivilegedCommitIdentity, "principal" | "nonce" | "target">,
      ): void => {
        this.#transaction(() => {
          const result = this.#db
            .prepare(`UPDATE privileged_commit_grants SET state='finished'
            WHERE permit=? AND identity=? AND state='outstanding'`)
            .run(permit, canonical(identityFor(input)));
          if (result.changes !== 1) throw unavailable();
        });
      },
      fence: async (): Promise<void> => {
        if (!exited) child.kill("SIGKILL");
        // kill success, a timeout, and pipe EOF are NOT proof of exit.
        await exit;
      },
      exited: exit,
    };
    this.#children.set(incarnation, channel);
    void exit.then(
      () => this.#children.delete(incarnation),
      () => {},
    );
    return channel;
  }
}
