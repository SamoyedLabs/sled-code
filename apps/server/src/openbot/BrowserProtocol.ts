// Openbot 0.60.0 / 0c7753fa: route-browser.ts and browser-view-gateway.ts.
// This adapter is server-only. Neither the upstream path nor token crosses the Sled wire.
import { createBrowserSessionPool, type BrowserPeer } from "./BrowserSessionPool.ts";
export interface BrowserSession {
  create(tabId: string): Promise<{ id: string; tabId: string; streamPath: string }>;
  close(id: string): Promise<void>;
  dial(path: string): BrowserPeer;
}
export function createBrowserSession(options: {
  origin: string;
  request: (path: string, method: "POST" | "DELETE", body?: unknown) => Promise<unknown>;
  token: string;
  isClosed: () => boolean;
  peers: Set<() => void>;
}): BrowserSession {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("Invalid browser host");
  return createBrowserSessionPool({ ...options, origin });
}

/** Sled-side draw credits. The upstream pool remains in released baseline mode. */
export class BrowserFrameDelivery {
  #drawing: number | undefined;
  #pending: { sequence: number; bytes: Uint8Array } | undefined;
  readonly acknowledged: boolean;
  constructor(acknowledged: boolean) {
    this.acknowledged = acknowledged;
  }
  offer(sequence: number, bytes: Uint8Array): Uint8Array | undefined {
    if (!this.acknowledged) return bytes;
    if (this.#drawing !== undefined) {
      this.#pending = { sequence, bytes };
      return;
    }
    this.#drawing = sequence;
    return bytes;
  }
  acknowledge(sequence: number): Uint8Array | undefined {
    if (sequence !== this.#drawing) return;
    this.#drawing = undefined;
    const pending = this.#pending;
    this.#pending = undefined;
    return pending ? this.offer(pending.sequence, pending.bytes) : undefined;
  }
}

import type { BrowserViewInput } from "@t3tools/contracts";
/** Only controls actually forwarded by this viewer are released. No host clipboard access. */
export class BrowserHeldInput {
  readonly #keys = new Map<string, Extract<BrowserViewInput, { type: "key" }>>();
  readonly #buttons = new Map<string, Extract<BrowserViewInput, { type: "pointer" }>>();
  record(input: BrowserViewInput) {
    if (input.type === "key") {
      const id = input.code || input.key;
      if (input.action === "down") {
        if (!this.#keys.has(id) && this.#keys.size >= 64) throw new Error("Too many held keys");
        this.#keys.set(id, input);
      } else if (input.action === "up") this.#keys.delete(id);
    } else if (input.type === "pointer") {
      if (input.action === "down") this.#buttons.set(input.button, input);
      else if (input.action === "up") this.#buttons.delete(input.button);
      else if (input.action === "move")
        for (const [button, held] of this.#buttons)
          this.#buttons.set(button, { ...held, x: input.x, y: input.y });
    }
  }
  release(): readonly BrowserViewInput[] {
    const inputs: BrowserViewInput[] = [
      ...[...this.#buttons.values()].map((input) => ({
        ...input,
        action: "up" as const,
        modifiers: 0,
      })),
      ...[...this.#keys.values()].map((input) => ({
        ...input,
        action: "up" as const,
        text: "",
        modifiers: 0,
      })),
    ];
    this.#buttons.clear();
    this.#keys.clear();
    return inputs;
  }
}
