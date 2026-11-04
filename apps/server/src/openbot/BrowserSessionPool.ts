// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Private socket leases own identities and event delivery.
import * as NodeEvents from "node:events";
import * as NodeCrypto from "node:crypto";
import { WebSocket, type RawData } from "@effect/platform-node/NodeWS";
import { decodeBrowserViewInput, type BrowserViewInput } from "@t3tools/contracts";
import type { BrowserSession } from "./BrowserProtocol.ts";

export interface BrowserPeer extends NodeJS.EventEmitter {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
type Lease = { id: string; pool: Pool; peer?: LeasePeer };
type PoolRecord = { creating: Promise<Pool> };
type Pool = {
  tabId: string;
  physicalId: string;
  streamPath: string;
  record: PoolRecord;
  leases: Set<Lease>;
  socket?: WebSocket;
  frame?: { bytes: Buffer; version: number };
  inputOwner?: LeasePeer;
  closing: boolean;
  closingPromise?: Promise<void>;
};

class LeasePeer extends NodeEvents.EventEmitter implements BrowserPeer {
  #closed = false;
  #seen = 0;
  readonly #keys = new Map<string, Extract<BrowserViewInput, { type: "key" }>>();
  #button: Extract<BrowserViewInput, { type: "pointer" }> | undefined;
  readonly pool: Pool;
  readonly release: () => void;
  constructor(pool: Pool, release: () => void) {
    super();
    this.pool = pool;
    this.release = release;
    this.on("newListener", (event) => {
      if (event === "message") queueMicrotask(() => this.deliver());
    });
  }
  get readyState() {
    return this.#closed || this.pool.closing
      ? WebSocket.CLOSED
      : (this.pool.socket?.readyState ?? WebSocket.CONNECTING);
  }
  get bufferedAmount() {
    return this.pool.socket?.bufferedAmount ?? 0;
  }
  send(data: string) {
    if (this.readyState !== WebSocket.OPEN) throw new Error("Browser view closed");
    const input = decodeBrowserViewInput(data);
    // The host has one held pointer button; one lease owns input until all its holds end.
    if (input.type !== "ack" && this.pool.inputOwner && this.pool.inputOwner !== this)
      throw new Error("Browser input is held by another viewer");
    if (input.type === "key") {
      const id = input.code || input.key;
      if (input.action === "up" && !this.#keys.has(id)) return;
      if (input.action === "down" && !this.#keys.has(id) && this.#keys.size >= 64)
        throw new Error("Too many held browser keys");
    }
    if (input.type === "pointer") {
      if (input.action === "down" && this.#button && this.#button.button !== input.button)
        throw new Error("Release the current browser button before pressing another");
      if (input.action === "up" && this.#button?.button !== input.button) return;
    }
    this.pool.socket!.send(data);
    if (input.type === "key") {
      const id = input.code || input.key;
      if (input.action === "down") this.#keys.set(id, input);
      else if (input.action === "up") this.#keys.delete(id);
    } else if (input.type === "pointer") {
      if (input.action === "down") this.#button = input;
      else if (input.action === "up") this.#button = undefined;
      else if (input.action === "move" && this.#button)
        this.#button = { ...this.#button, x: input.x, y: input.y };
    }
    if (this.#keys.size > 0 || this.#button) this.pool.inputOwner = this;
    else if (this.pool.inputOwner === this) delete this.pool.inputOwner;
  }
  releaseInput() {
    const inputs = [
      ...(this.#button ? [{ ...this.#button, action: "up", modifiers: 0 }] : []),
      ...[...this.#keys.values()].map((input) => ({
        ...input,
        action: "up",
        text: "",
        modifiers: 0,
      })),
    ];
    this.#button = undefined;
    this.#keys.clear();
    if (this.pool.inputOwner === this) delete this.pool.inputOwner;
    for (const input of inputs) {
      const packet = JSON.stringify(input);
      const socket = this.pool.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount + Buffer.byteLength(packet) > 64 * 1024)
        throw new Error("Browser input release is congested");
      socket.send(packet);
    }
  }
  close() {
    if (!this.#closed) this.release();
  }
  opened() {
    if (!this.#closed) {
      this.emit("open");
      this.deliver();
    }
  }
  deliver() {
    const frame = this.pool.frame;
    if (
      this.readyState !== WebSocket.OPEN ||
      !frame ||
      frame.version === this.#seen ||
      this.listenerCount("message") === 0
    )
      return;
    this.#seen = frame.version;
    this.emit("message", frame.bytes, true);
  }
  text(data: RawData) {
    if (!this.#closed) this.emit("message", data, false);
  }
  ended(error?: Error) {
    if (this.#closed) return;
    this.#closed = true;
    if (error && this.listenerCount("error") > 0) this.emit("error", error);
    this.emit("close", 1000, Buffer.from("Browser view ended"));
  }
}

export function createBrowserSessionPool(options: {
  origin: URL;
  request: (path: string, method: "POST" | "DELETE", body?: unknown) => Promise<unknown>;
  token: string;
  isClosed: () => boolean;
  peers: Set<() => void>;
}): BrowserSession {
  const pools = new Map<string, PoolRecord>();
  const leases = new Map<string, Lease>();
  const releasing = new Map<string, Promise<void>>();
  let stopped = false;
  const tidy = () => {
    if (pools.size === 0) options.peers.delete(shutdown);
  };
  const closePool = (pool: Pool, error?: Error): Promise<void> => {
    if (pool.closingPromise) return pool.closingPromise;
    pool.closing = true;
    const promise = Promise.resolve().then(async () => {
      const owned = [...pool.leases];
      pool.leases.clear();
      let failure = error;
      for (const lease of owned) {
        leases.delete(lease.id);
        releasing.set(lease.id, promise);
        try {
          lease.peer?.releaseInput();
        } catch (cause) {
          failure ??= cause instanceof Error ? cause : new Error("Browser input release failed");
        }
        lease.peer?.ended(failure);
      }
      try {
        // DELETE awaits upstream's stopView; socket-first close loses that cleanup barrier.
        await options.request(`/v1/browser/view/sessions/${pool.physicalId}`, "DELETE");
        if (pools.get(pool.tabId) === pool.record) pools.delete(pool.tabId);
      } finally {
        pool.socket?.close(1000, "Browser host closed");
        for (const lease of owned) releasing.delete(lease.id);
        tidy();
      }
    });
    pool.closingPromise = promise;
    return promise;
  };
  const shutdown = () => {
    stopped = true;
    for (const record of pools.values())
      void record.creating.then((pool) => closePool(pool)).catch(() => {});
  };
  const release = (lease: Lease): Promise<void> => {
    const existing = releasing.get(lease.id);
    if (existing) return existing;
    if (!leases.delete(lease.id)) return Promise.resolve();
    try {
      lease.peer?.releaseInput();
    } catch (cause) {
      const closing = closePool(
        lease.pool,
        cause instanceof Error ? cause : new Error("Browser input release failed"),
      );
      releasing.set(lease.id, closing);
      return closing;
    }
    lease.pool.leases.delete(lease);
    const promise = lease.pool.leases.size === 0 ? closePool(lease.pool) : Promise.resolve();
    releasing.set(lease.id, promise);
    lease.peer?.ended();
    void promise.finally(() => releasing.delete(lease.id)).catch(() => {});
    return promise;
  };
  const physical = (tabId: string): PoolRecord => {
    const existing = pools.get(tabId);
    if (existing) return existing;
    const record: PoolRecord = {
      creating: Promise.resolve().then(async () => {
        const value = await options.request("/v1/browser/view/sessions", "POST", { tabId });
        if (
          typeof value !== "object" ||
          value === null ||
          !("id" in value) ||
          !("tabId" in value) ||
          !("streamPath" in value) ||
          typeof value.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) ||
          value.tabId !== tabId ||
          value.streamPath !== `/v1/browser/view/sessions/${value.id}/stream`
        )
          throw new Error("Invalid browser session");
        const pool: Pool = {
          tabId,
          physicalId: value.id,
          streamPath: String(value.streamPath),
          record,
          leases: new Set(),
          closing: false,
        };
        if (stopped || options.isClosed()) {
          await closePool(pool);
          throw new Error("Browser host closed");
        }
        return pool;
      }),
    };
    pools.set(tabId, record);
    options.peers.add(shutdown);
    void record.creating.catch(() => {
      if (pools.get(tabId) === record) pools.delete(tabId);
      tidy();
    });
    return record;
  };
  const create = async (
    tabId: string,
  ): Promise<{ id: string; tabId: string; streamPath: string }> => {
    if (stopped || options.isClosed() || !tabId || tabId.length > 128)
      throw new Error("Browser host closed");
    const pool = await physical(tabId).creating;
    if (pool.closing) {
      await pool.closingPromise;
      return create(tabId);
    }
    if (stopped || options.isClosed()) {
      await closePool(pool);
      throw new Error("Browser host closed");
    }
    const id = NodeCrypto.randomUUID();
    const lease: Lease = { id, pool };
    leases.set(id, lease);
    pool.leases.add(lease);
    return { id, tabId, streamPath: `/v1/browser/view/sessions/${id}/stream` };
  };
  return {
    create,
    async close(id) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid browser session");
      const pending = releasing.get(id);
      if (pending) return pending;
      const lease = leases.get(id);
      if (lease) await release(lease);
    },
    dial(path) {
      const match = /^\/v1\/browser\/view\/sessions\/([A-Za-z0-9_-]{1,64})\/stream$/.exec(path);
      const lease = match ? leases.get(match[1]!) : undefined;
      if (stopped || options.isClosed() || !lease || lease.peer || lease.pool.closing)
        throw new Error("Invalid browser stream");
      const pool = lease.pool;
      const peer = new LeasePeer(pool, () => {
        void release(lease).catch(() => {});
      });
      lease.peer = peer;
      if (!pool.socket) {
        const socket = new WebSocket(
          `ws://${options.origin.host}${pool.streamPath}`,
          [`openbot-token.${options.token}`],
          { followRedirects: false, maxPayload: 2 * 1024 * 1024 + 12, handshakeTimeout: 10_000 },
        );
        pool.socket = socket;
        socket.once("open", () => {
          for (const current of pool.leases) current.peer?.opened();
        });
        socket.on("message", (bytes, binary) => {
          if (pool.closing) return;
          if (binary) {
            pool.frame = {
              bytes: Array.isArray(bytes)
                ? Buffer.concat(bytes)
                : bytes instanceof ArrayBuffer
                  ? Buffer.from(bytes)
                  : Buffer.from(bytes),
              version: (pool.frame?.version ?? 0) + 1,
            };
            for (const current of pool.leases) current.peer?.deliver();
          } else for (const current of pool.leases) current.peer?.text(bytes);
        });
        socket.once("error", (error) => {
          void closePool(pool, error).catch(() => {});
        });
        socket.once("close", () => {
          void closePool(pool).catch(() => {});
        });
      }
      return peer;
    },
  };
}
