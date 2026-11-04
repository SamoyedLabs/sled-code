// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Server-only opaque grants and injected clock; no Effect execution in this transport module.
import * as NodeCrypto from "node:crypto";
import type { BrowserSession } from "./BrowserProtocol.ts";
import type { OpenbotBrowserViewerGrant } from "@t3tools/contracts";

type Entry = {
  principal: string;
  hostId: string;
  token: string;
  expiresAt: number;
  session: BrowserSession;
  upstreamId: string;
  path: string;
  connected: boolean;
  stop?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};
// Call authorize on every operation using current Sled authority, never a cached owner role.
export class BrowserViews {
  readonly #entries = new Map<string, Entry>();
  #stopped = false;
  #opening = 0;
  readonly options: {
    now?: () => number;
    authorize: (principal: string, hostId: string) => Promise<void>;
    create: (
      hostId: string,
      tabId: string,
    ) => Promise<{
      session: BrowserSession;
      upstream: Awaited<ReturnType<BrowserSession["create"]>>;
    }>;
  };
  constructor(options: BrowserViews["options"]) {
    this.options = options;
  }
  async open(principal: string, hostId: string, tabId: string): Promise<OpenbotBrowserViewerGrant> {
    await this.options.authorize(principal, hostId);
    if (
      this.#stopped ||
      this.#entries.size + this.#opening >= 32 ||
      tabId.length === 0 ||
      tabId.length > 128
    )
      throw new Error("Browser view unavailable");
    this.#opening++;
    try {
      const { session, upstream } = await this.options.create(hostId, tabId);
      // Authority may have changed while the host was creating the session.
      try {
        await this.options.authorize(principal, hostId);
        if (this.#stopped) throw new Error("Browser view closed");
      } catch (error) {
        await session.close(upstream.id);
        throw error;
      }
      const id = NodeCrypto.randomUUID();
      const token = NodeCrypto.randomBytes(32).toString("hex");
      const expiresAt = (this.options.now?.() ?? Date.now()) + 60_000;
      this.#entries.set(id, {
        principal,
        hostId,
        token,
        expiresAt,
        session,
        upstreamId: upstream.id,
        path: upstream.streamPath,
        connected: false,
      });
      const timer = setTimeout(() => {
        void this.#remove(id).catch(() => {});
      }, 60_000);
      timer.unref();
      this.#entries.get(id)!.timer = timer;
      return { id, token, hostId, tabId, expiresAt };
    } finally {
      this.#opening--;
    }
  }
  async #remove(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    clearTimeout(entry.timer);
    entry.stop?.();
    await entry.session.close(entry.upstreamId);
  }
  async #owned(principal: string, hostId: string, id: string) {
    const entry = this.#entries.get(id);
    if (!entry || entry.principal !== principal || entry.hostId !== hostId)
      throw new Error("Browser view unavailable");
    try {
      await this.options.authorize(principal, hostId);
      if (!entry.connected && (this.options.now?.() ?? Date.now()) >= entry.expiresAt)
        throw new Error("Browser view expired");
    } catch (error) {
      await this.#remove(id);
      throw error;
    }
    if (this.#entries.get(id) !== entry) throw new Error("Browser view closed");
    return entry;
  }
  async connect(principal: string, hostId: string, id: string, token: string) {
    const entry = await this.#owned(principal, hostId, id);
    const supplied = Buffer.from(token);
    const expected = Buffer.from(entry.token);
    if (
      entry.connected ||
      supplied.length !== expected.length ||
      !NodeCrypto.timingSafeEqual(supplied, expected)
    )
      throw new Error("Browser view unavailable");
    entry.connected = true;
    clearTimeout(entry.timer);
    try {
      const socket = entry.session.dial(entry.path);
      entry.stop = () => socket.close(1000, "Browser view ended");
      socket.once("close", () => {
        void this.#remove(id).catch(() => {});
      });
      return socket;
    } catch (error) {
      await this.#remove(id);
      throw error;
    }
  }
  async check(principal: string, hostId: string, id: string) {
    await this.#owned(principal, hostId, id);
  }
  async close(principal: string, hostId: string, id: string) {
    await this.#owned(principal, hostId, id);
    await this.#remove(id);
  }
  async revoke(principal: string) {
    await Promise.all(
      [...this.#entries]
        .filter(([, entry]) => entry.principal === principal)
        .map(([id]) => this.#remove(id)),
    );
  }
  async sweep() {
    await Promise.all(
      [...this.#entries.keys()].map(async (id) => {
        const entry = this.#entries.get(id);
        if (entry) await this.#owned(entry.principal, entry.hostId, id).catch(() => {});
      }),
    );
  }
  async stop() {
    this.#stopped = true;
    await Promise.all([...this.#entries.keys()].map((id) => this.#remove(id)));
  }
}
