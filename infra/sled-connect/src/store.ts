import { workerNow, workerUuid } from "./platform.ts";
import { RelayError } from "./config.ts";

export interface EnvironmentRow {
  id: string;
  user_id: string;
  public_key: string;
  label: string;
  hostname: string;
  tunnel_name: string;
  tunnel_id: string | null;
  dns_id: string | null;
  origin_json: string;
  credential_hash: string | null;
  linked_at: string;
  revoked: number;
  hold_offline: number;
}

export class RelayStore {
  readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async consumeNonce(id: string, expires: number): Promise<void> {
    const now = Math.floor(workerNow() / 1000);
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM nonces WHERE expires < ?").bind(now),
      this.db
        .prepare("INSERT OR IGNORE INTO nonces(id, expires) VALUES (?, ?)")
        .bind(id, expires + 10),
    ]);
    if (results[1]?.meta.changes !== 1) throw new RelayError(401, "proof_replayed");
  }

  async environment(id: string, userId: string): Promise<EnvironmentRow> {
    const row = await this.db
      .prepare("SELECT * FROM environments WHERE id=? AND user_id=? AND revoked=0")
      .bind(id, userId)
      .first<EnvironmentRow>();
    if (!row) throw new RelayError(403, "environment_link_not_found");
    return row;
  }

  async withLease<A>(id: string, operation: () => Promise<A>): Promise<A> {
    const holder = workerUuid();
    const now = Math.floor(workerNow() / 1000);
    const result = await this.db
      .prepare(
        "INSERT INTO leases(id,holder,expires) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET holder=excluded.holder,expires=excluded.expires WHERE leases.expires < ?",
      )
      .bind(id, holder, now + 120, now)
      .run();
    if (result.meta.changes !== 1) throw new RelayError(409, "environment_busy");
    try {
      return await operation();
    } finally {
      await this.db.prepare("DELETE FROM leases WHERE id=? AND holder=?").bind(id, holder).run();
    }
  }
}
