// @effect-diagnostics nodeBuiltinImport:off -- opaque one-use privileged commit permits.
import * as NodeCrypto from "node:crypto";
import type { PrivilegedResponseTarget } from "@t3tools/contracts/openbot-privileged-response";

export interface PrivilegedCommitIdentity {
  readonly principal: string;
  readonly environmentId: string;
  readonly hostId: string;
  readonly engineIncarnation: string;
  readonly nonce: string;
  readonly target: PrivilegedResponseTarget;
}
const refused = () => new Error("Privileged commit unavailable");
const same = (a: PrivilegedCommitIdentity, b: PrivilegedCommitIdentity) =>
  a.principal === b.principal &&
  a.environmentId === b.environmentId &&
  a.hostId === b.hostId &&
  a.engineIncarnation === b.engineIncarnation &&
  a.nonce === b.nonce &&
  Object.keys(a.target).every(
    (key) =>
      a.target[key as keyof PrivilegedResponseTarget] ===
      b.target[key as keyof PrivilegedResponseTarget],
  );

/** Revocation completion must await drain; unknown commits never expire into permission to retry. */
export class PrivilegedResponseCommitAuthority {
  readonly #revoking = new Set<string>();
  readonly #exited = new Set<string>();
  readonly #permits = new Map<string, PrivilegedCommitIdentity>();
  readonly #used = new Set<string>();
  readonly #waiters = new Map<string, Set<() => void>>();
  readonly #validateLive: (identity: PrivilegedCommitIdentity) => void;
  constructor(validateLive: (identity: PrivilegedCommitIdentity) => void) {
    this.#validateLive = validateLive;
  }

  acquire(identity: PrivilegedCommitIdentity): string {
    if (this.#revoking.has(identity.principal) || this.#exited.has(identity.engineIncarnation))
      throw refused();
    this.#validateLive(identity);
    const attempt = `${identity.engineIncarnation}\n${identity.nonce}`;
    if (this.#used.has(attempt) || this.#used.size >= 4096) throw refused();
    this.#used.add(attempt);
    const permit = NodeCrypto.randomUUID();
    this.#permits.set(permit, { ...identity, target: { ...identity.target } });
    return permit;
  }

  finish(permit: string, identity: PrivilegedCommitIdentity): void {
    const original = this.#permits.get(permit);
    if (!original || !same(original, identity)) throw refused();
    this.#permits.delete(permit);
    this.#drain(original.principal);
  }

  revoke(principal: string): Promise<void> {
    this.#revoking.add(principal);
    if (![...this.#permits.values()].some((value) => value.principal === principal))
      return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(principal) ?? new Set<() => void>();
      waiters.add(resolve);
      this.#waiters.set(principal, waiters);
    });
  }

  /** Only the process owner may attest this exact child has exited and cannot commit later. */
  engineExited(engineIncarnation: string): void {
    this.#exited.add(engineIncarnation);
    for (const attempt of this.#used)
      if (attempt.startsWith(`${engineIncarnation}\n`)) this.#used.delete(attempt);
    for (const [permit, identity] of this.#permits) {
      if (identity.engineIncarnation !== engineIncarnation) continue;
      this.#permits.delete(permit);
      this.#drain(identity.principal);
    }
  }

  #drain(principal: string): void {
    if ([...this.#permits.values()].some((value) => value.principal === principal)) return;
    for (const resolve of this.#waiters.get(principal) ?? []) resolve();
    this.#waiters.delete(principal);
  }
}
