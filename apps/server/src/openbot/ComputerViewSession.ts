// @effect-diagnostics nodeBuiltinImport:off - Private HTTP and websocket adapter; credentials never cross the public transport.
import * as NodeHttp from "node:http";
import { WebSocket } from "@effect/platform-node/NodeWS";

export interface ComputerSession {
  readonly isClosed: () => boolean;
  readonly target: string;
  readonly upstreamId: string;
  request(
    path: string,
    method: "GET" | "POST",
    body?: Uint8Array,
  ): Promise<{ status: number; type: string; bytes: Uint8Array }>;
  dial(): WebSocket;
  test(action: "start" | "status" | "stop"): Promise<unknown>;
  close(): Promise<void>;
}
export function computerProxyPath(path: string, method: "GET" | "POST") {
  if (path.length > 4096 || /[%\\#\x00-\x20]/.test(path)) return false;
  const [pathname] = path.split("?");
  if (!pathname || pathname.includes("..") || pathname.includes("//")) return false;
  if (method === "POST")
    return pathname === "/viewer-state" || pathname === "/moonlight/openbot-clipboard";
  if (!pathname.startsWith("/moonlight/")) return false;
  const asset = pathname.slice("/moonlight".length);
  if (["/", "/index.html", "/index.js", "/admin.html", "/admin.js"].includes(asset)) return false;
  if (asset.startsWith("/api/")) return asset === "/api/authenticate" || asset === "/api/role";
  return /^\/[A-Za-z0-9_./-]+$/.test(asset);
}
export async function createComputerViewSession(options: {
  origin: string;
  request: (path: string, method: "POST" | "DELETE", body?: unknown) => Promise<unknown>;
  isClosed: () => boolean;
  http?: typeof computerHttpRequest;
}): Promise<ComputerSession> {
  const http = options.http ?? computerHttpRequest;
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
    throw new Error("Invalid computer host");
  const raw = await options.request("/v1/remote-screen/sessions", "POST", {});
  if (
    typeof raw !== "object" ||
    !raw ||
    !("id" in raw) ||
    typeof raw.id !== "string" ||
    !/^[A-Za-z0-9-]{1,128}$/.test(raw.id)
  )
    throw new Error("Invalid computer session");
  const id = raw.id;
  const base = `/v1/remote-screen/sessions/${id}`;
  const peers = new Set<WebSocket>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closed = true;
    for (const peer of peers) peer.close(1000, "Computer session ended");
    closing = options.request(base, "DELETE").then(() => undefined);
    return closing;
  };
  try {
    if (
      !("viewerGrant" in raw) ||
      typeof raw.viewerGrant !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(raw.viewerGrant) ||
      options.isClosed()
    )
      throw new Error("Invalid computer session");
    const authorization = await http(new URL(`${base}/authorize`, origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: raw.viewerGrant }),
      limit: 32_768,
    });
    const cookie = authorization.headers.get("set-cookie")?.split(";")[0];
    if (authorization.status !== 204 || !cookie || !/^[A-Za-z0-9_-]+=[A-Za-z0-9_-]+$/.test(cookie))
      throw new Error("Computer authorization failed");
    const viewer = await http(new URL(`${base}/viewer`, origin), {
      limit: 32_768,
    });
    const page = new TextDecoder().decode(viewer.bytes);
    const match = /location\.replace\(("[^"\n]+")\)/.exec(page);
    const target: unknown = match ? JSON.parse(match[1]!) : null;
    if (
      typeof target !== "string" ||
      !target.startsWith(`${base}/moonlight/stream.html?`) ||
      !computerProxyPath(target.slice(base.length), "GET")
    )
      throw new Error("Invalid computer viewer");
    if (options.isClosed()) throw new Error("Computer host closed");
    return {
      isClosed: () => closed || options.isClosed(),
      target: target.slice(base.length),
      upstreamId: id,
      close,
      async request(path, method, body) {
        if (
          closed ||
          options.isClosed() ||
          !computerProxyPath(path, method) ||
          (body?.byteLength ?? 0) > 1024 * 1024
        )
          throw new Error("Computer request rejected");
        const response = await http(new URL(`${base}${path}`, origin), {
          method,
          headers: {
            cookie,
            "content-type": path === "/viewer-state" ? "application/json" : "text/plain",
            "sec-fetch-site": "same-origin",
            "accept-encoding": "identity",
          },
          ...(body ? { body: Buffer.from(body) } : {}),
          limit: 16 * 1024 * 1024,
        });
        if (response.status >= 300 && response.status < 400)
          throw new Error("Computer redirect rejected");
        return {
          status: response.status,
          type: response.headers.get("content-type") ?? "application/octet-stream",
          bytes: response.bytes,
        };
      },
      dial() {
        if (closed || options.isClosed()) throw new Error("Computer host closed");
        const socket = new WebSocket(`ws://${origin.host}${base}/stream`, {
          headers: { cookie },
          followRedirects: false,
          maxPayload: 1024 * 1024 + 69,
          handshakeTimeout: 10_000,
        });
        peers.add(socket);
        socket.once("close", () => peers.delete(socket));
        return socket;
      },
      async test(action) {
        if (closed || options.isClosed()) throw new Error("Computer host closed");
        return options.request("/v1/remote-screen/test", "POST", { sessionId: id, action });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
async function computerHttpRequest(
  url: URL,
  input: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    limit: number;
  },
) {
  return new Promise<{ status: number; headers: Headers; bytes: Uint8Array }>((resolve, reject) => {
    const request = NodeHttp.request(
      url,
      {
        method: input.method ?? "GET",
        headers: input.headers,
        signal: AbortSignal.timeout(15_000),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.byteLength;
          if (length > input.limit) {
            response.destroy(new Error("Computer response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve({
            status: response.statusCode ?? 502,
            headers,
            bytes: new Uint8Array(Buffer.concat(chunks)),
          });
        });
      },
    );
    request.once("error", reject);
    request.end(input.body);
  });
}
