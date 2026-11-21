// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Private socket leases own identities and event delivery.
import * as NodeEvents from "node:events";
import * as NodeCrypto from "node:crypto";
import { WebSocket, type RawData } from "@effect/platform-node/NodeWS";
import {
  decodeBrowserViewFrame,
  decodeBrowserViewInput,
  decodeBrowserViewHostMessage,
  type OpenbotBrowserViewFeatures,
  type BrowserViewInput,
} from "@t3tools/contracts";
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
  features?: OpenbotBrowserViewFeatures;
  cursor?: string;
  copyOwner?: LeasePeer;
  menuOwner?: LeasePeer;
  physicalId: string;
  streamPath: string;
  record: PoolRecord;
  leases: Set<Lease>;
  socket?: WebSocket;
  frame?: { bytes: Buffer; version: number };
  inputOwner?: LeasePeer;
  frameFloor: number;
  retained: number[];
  closing: boolean;
  closingPromise?: Promise<void>;
};

function advanceFrames(pool: Pool) {
  if (!pool.features?.framePoint || pool.socket?.readyState !== WebSocket.OPEN) return;
  const active = [...pool.leases].flatMap((lease) => (lease.peer ? [lease.peer.acknowledged] : []));
  if (active.length === 0) return;
  const minimum = Math.min(...active);
  if (minimum > pool.frameFloor) {
    pool.socket.send(JSON.stringify({ type: "ack", sequence: minimum }));
    pool.frameFloor = minimum;
    pool.retained = pool.retained.filter((sequence) => sequence >= minimum);
  }
}

class LeasePeer extends NodeEvents.EventEmitter implements BrowserPeer {
  #closed = false;
  #seen = 0;
  acknowledged = 0;
  #cursorSeen: string | undefined;
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
    if (input.type === "ack") {
      if (!this.pool.features?.framePoint) return;
      this.acknowledged = Math.max(this.acknowledged, input.sequence);
      advanceFrames(this.pool);
      return;
    }
    if (
      input.type === "pointer" &&
      input.sequence !== undefined &&
      input.sequence < this.pool.frameFloor
    )
      throw new Error("The displayed frame is no longer retained. Reconnect the viewer.");
    // The host has one held pointer button; one lease owns input until all its holds end.
    if (this.pool.inputOwner && this.pool.inputOwner !== this)
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
    if (input.type === "copy") {
      if (!this.pool.features?.clipboard) throw new Error("Browser clipboard unavailable");
      if (this.pool.copyOwner) throw new Error("Browser copy already pending");
      this.pool.copyOwner = this;
    }
    if ((input.type === "paste" || input.type === "cut") && !this.pool.features?.clipboard)
      throw new Error("Browser clipboard unavailable");
    if (
      input.type === "pointer" &&
      input.action === "down" &&
      input.button === "right" &&
      this.pool.features?.contextMenu
    ) {
      if (this.pool.menuOwner && this.pool.menuOwner !== this)
        throw new Error("Browser menu already pending");
      this.pool.menuOwner = this;
    }
    try {
      this.pool.socket!.send(data);
      if (input.type === "pointer" && input.sequence !== undefined)
        this.pool.frameFloor = Math.max(this.pool.frameFloor, input.sequence);
    } catch (error) {
      if (input.type === "copy" && this.pool.copyOwner === this) delete this.pool.copyOwner;
      throw error;
    }
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
      ...(this.#button
        ? [{ ...this.#button, action: "up", modifiers: 0, sequence: undefined }]
        : []),
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
    if (this.readyState !== WebSocket.OPEN || this.listenerCount("message") === 0) return;
    const frame = this.pool.frame;
    if (frame && frame.version !== this.#seen) {
      this.#seen = frame.version;
      this.emit("message", frame.bytes, true);
    }
    if (this.pool.cursor && this.pool.cursor !== this.#cursorSeen) this.cursor(this.pool.cursor);
  }
  cursor(text: string) {
    if (this.#closed || this.listenerCount("message") === 0) return;
    this.#cursorSeen = text;
    this.emit("message", Buffer.from(text), false);
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
    if (lease.pool.leases.size > 0) advanceFrames(lease.pool);
    const promise = lease.pool.leases.size === 0 ? closePool(lease.pool) : Promise.resolve();
    releasing.set(lease.id, promise);
    lease.peer?.ended();
    void promise.finally(() => releasing.delete(lease.id)).catch(() => {});
    return promise;
  };
  const physical = (tabId: string, features?: OpenbotBrowserViewFeatures): PoolRecord => {
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
          ...(features ? { features } : {}),
          physicalId: value.id,
          streamPath: String(value.streamPath),
          record,
          leases: new Set(),
          closing: false,
          frameFloor: 0,
          retained: [],
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
    features?: OpenbotBrowserViewFeatures,
  ): ReturnType<BrowserSession["create"]> => {
    if (stopped || options.isClosed() || !tabId || tabId.length > 128)
      throw new Error("Browser host closed");
    const pool = await physical(tabId, features).creating;
    if (pool.closing) {
      await pool.closingPromise;
      return create(tabId, features);
    }
    if (
      features?.viewport &&
      (features.viewport.width !== pool.features?.viewport?.width ||
        features.viewport.height !== pool.features?.viewport?.height)
    )
      throw new Error(
        "Another viewer owns this tab's viewport. Close its viewers before changing size.",
      );
    if (pool.features?.framePoint && !features?.framePoint)
      throw new Error("Reconnect using an acknowledged frame-point viewer");
    if (
      features &&
      ((features.framePoint && !pool.features?.framePoint) ||
        (features.clipboard && !pool.features?.clipboard) ||
        (features.cursor && !pool.features?.cursor) ||
        (features.contextMenu && !pool.features?.contextMenu))
    )
      throw new Error("Reconnect existing browser viewers to enable advanced controls");
    if (stopped || options.isClosed()) {
      await closePool(pool);
      throw new Error("Browser host closed");
    }
    const id = NodeCrypto.randomUUID();
    const lease: Lease = { id, pool };
    leases.set(id, lease);
    pool.leases.add(lease);
    return {
      id,
      tabId,
      streamPath: `/v1/browser/view/sessions/${id}/stream`,
      ...(pool.features ? { features: pool.features } : {}),
    };
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
          `ws://${options.origin.host}${pool.streamPath}${pool.features ? `?frameAck=${pool.features.framePoint ? 1 : 0}&viewport=${pool.features.viewport ? `${pool.features.viewport.width}x${pool.features.viewport.height}` : ""}&cursor=${pool.features.cursor ? 1 : 0}&menu=${pool.features.contextMenu ? 1 : 0}` : ""}`,
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
            if (pool.features?.framePoint) {
              try {
                const frame = decodeBrowserViewFrame(pool.frame.bytes);
                pool.retained = pool.retained.filter((sequence) => sequence >= pool.frameFloor);
                pool.retained.push(frame.sequence);
                // Leave room below the pinned host's 120-frame retention cap.
                const oldest = pool.retained.at(-100);
                if (pool.retained.length > 100 && oldest !== undefined)
                  for (const current of pool.leases)
                    if (current.peer && current.peer.acknowledged < oldest) current.peer.close();
              } catch {
                void closePool(pool, new Error("Invalid browser frame")).catch(() => {});
                return;
              }
            }
            for (const current of pool.leases) current.peer?.deliver();
          } else {
            try {
              const text = Buffer.isBuffer(bytes)
                ? bytes.toString("utf8")
                : Array.isArray(bytes)
                  ? Buffer.concat(bytes).toString("utf8")
                  : Buffer.from(bytes).toString("utf8");
              const message = decodeBrowserViewHostMessage(text);
              if (!message) return;
              if (message.type === "copied" || message.type === "copyTooLarge") {
                const owner = pool.copyOwner;
                delete pool.copyOwner;
                owner?.text(Buffer.from(JSON.stringify(message)));
              } else if (message.type === "context-menu") {
                const owner = pool.menuOwner;
                delete pool.menuOwner;
                owner?.text(Buffer.from(JSON.stringify(message)));
              } else if (message.type === "cursor") {
                pool.cursor = JSON.stringify(message);
                for (const current of pool.leases) current.peer?.cursor(pool.cursor);
              }
            } catch {
              void closePool(pool, new Error("Invalid browser host message")).catch(() => {});
            }
          }
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
