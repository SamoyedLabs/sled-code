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
