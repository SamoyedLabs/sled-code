// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Opaque private leases use an injected clock and deadline cleanup.
import * as NodeCrypto from "node:crypto";
import type { ComputerSession } from "./ComputerViewSession.ts";

type Entry = {
  frameOrigin: string;
  principal: string;
  hostId: string;
  session: ComputerSession;
  ticket: string | null;
  cookie: string | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  stops: Set<() => void>;
};
export class ComputerViews {
  readonly #entries = new Map<string, Entry>();
  #opening = 0;
  #stopped = false;
  readonly options: {
    now?: () => number;
    authorize: (principal: string, hostId: string) => Promise<void>;
    create: (hostId: string) => Promise<ComputerSession>;
  };
  constructor(options: ComputerViews["options"]) {
    this.options = options;
  }
  #now() {
    return this.options.now?.() ?? Date.now();
  }
  async open(principal: string, hostId: string, frameOrigin: string) {
    if (frameOrigin !== "self") {
      const origin = new URL(frameOrigin);
      if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== frameOrigin)
        throw new Error("Invalid viewer origin");
    }
    await this.options.authorize(principal, hostId);
    if (this.#stopped || this.#entries.size + this.#opening >= 16)
      throw new Error("Computer unavailable");
    this.#opening++;
    try {
      const session = await this.options.create(hostId);
      try {
        await this.options.authorize(principal, hostId);
        if (this.#stopped) throw new Error("Computer closed");
      } catch (error) {
        await session.close();
        throw error;
      }
      const id = NodeCrypto.randomUUID();
      const ticket = NodeCrypto.randomBytes(32).toString("hex");
      const expiresAt = this.#now() + 30_000;
      const timer = setTimeout(() => {
        void this.#remove(id).catch(() => {});
      }, 30_000);
      timer.unref();
      this.#entries.set(id, {
        frameOrigin,
        principal,
        hostId,
        session,
        ticket,
        cookie: null,
        expiresAt,
        timer,
        stops: new Set(),
      });
      return { id, hostId, ticket, expiresAt };
    } finally {
      this.#opening--;
    }
  }
  async #remove(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    clearTimeout(entry.timer);
    for (const stop of entry.stops) stop();
    await entry.session.close();
  }
  async #owned(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error("Computer session expired");
    try {
      await this.options.authorize(entry.principal, entry.hostId);
      if (entry.session.isClosed() || this.#now() >= entry.expiresAt)
        throw new Error("Computer session expired");
    } catch (error) {
      await this.#remove(id);
      throw error;
    }
    if (this.#entries.get(id) !== entry) throw new Error("Computer session closed");
    return entry;
  }
  async frameOrigin(id: string) {
    return (await this.#owned(id)).frameOrigin;
  }
  async claim(id: string, ticket: string) {
    const entry = await this.#owned(id);
    if (!equal(entry.ticket, ticket)) throw new Error("Computer ticket rejected");
    entry.ticket = null;
    entry.cookie = NodeCrypto.randomBytes(32).toString("hex");
    entry.expiresAt = this.#now() + 15 * 60_000;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void this.#remove(id).catch(() => {});
    }, 15 * 60_000);
    entry.timer.unref();
    return entry.cookie;
  }
  async access(id: string, cookie: string) {
    const entry = await this.#owned(id);
    if (!equal(entry.cookie, cookie)) throw new Error("Computer lease rejected");
    return entry;
  }
  async close(principal: string, hostId: string, id: string) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (entry.principal !== principal || entry.hostId !== hostId)
      throw new Error("Computer lease rejected");
    await this.options.authorize(principal, hostId);
    await this.#remove(id);
  }
  async sweep() {
    await Promise.all([...this.#entries.keys()].map((id) => this.#owned(id).catch(() => {})));
  }
  async revoke(principal: string) {
    await Promise.all(
      [...this.#entries]
        .filter(([, e]) => e.principal === principal)
        .map(([id]) => this.#remove(id)),
    );
  }
  async resetHost(hostId: string) {
    await Promise.all(
      [...this.#entries].filter(([, e]) => e.hostId === hostId).map(([id]) => this.#remove(id)),
    );
  }
  async stop() {
    this.#stopped = true;
    await Promise.all([...this.#entries.keys()].map((id) => this.#remove(id)));
  }
}
function equal(expected: string | null, supplied: string) {
  if (!expected || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return NodeCrypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
