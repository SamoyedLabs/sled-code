// @effect-diagnostics nodeBuiltinImport:off - Local socket fixture exercises the released binary protocol.
import * as NodeEvents from "node:events";
import { WebSocketServer } from "@effect/platform-node/NodeWS";
import { expect, it } from "@effect/vitest";
import {
  decodeBrowserViewFrame,
  decodeBrowserViewInput,
  browserViewInputForHost,
} from "@t3tools/contracts";
import { BrowserViews } from "./BrowserViews.ts";
import { createBrowserSession } from "./BrowserProtocol.ts";

it("shares a static tab stream between independent viewer leases and replays its latest frame", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const physical = Promise.withResolvers<import("@effect/platform-node/NodeWS").WebSocket>();
  const frame = Buffer.from([79, 66, 86, 49, 0, 0, 0, 7, 2, 128, 1, 224, 255, 216, 255, 217]);
  server.on("connection", (peer) => {
    physical.resolve(peer);
    peer.send(frame);
  });
  let creates = 0;
  const deleted: string[] = [];
  const peers = new Set<() => void>();
  const session = createBrowserSession({
    origin: `http://127.0.0.1:${address.port}`,
    token: "owner",
    peers,
    isClosed: () => false,
    request: async (path, method, body) => {
      if (method === "DELETE") {
        deleted.push(path);
        return null;
      }
      expect(body).toEqual({ tabId: "tab" });
      const id = `physical-${++creates}`;
      return { id, tabId: "tab", streamPath: `/v1/browser/view/sessions/${id}/stream` };
    },
  });
  const leases: string[] = [];
  try {
    const [a, b] = await Promise.all([session.create("tab"), session.create("tab")]);
    leases.push(a.id, b.id);
    expect(creates).toBe(1);
    expect(a.id).not.toBe(b.id);
    const first = session.dial(a.streamPath);
    const receivedA = NodeEvents.EventEmitter.once(first, "message");
    const [bytesA] = await receivedA;
    expect([...bytesA]).toEqual([...frame]);
    const second = session.dial(b.streamPath);
    const [bytesB] = await NodeEvents.EventEmitter.once(second, "message");
    expect([...bytesB]).toEqual([...frame]);
    await session.close(a.id);
    expect(deleted).toEqual([]);
    const upstream = await physical.promise;
    const typed = NodeEvents.EventEmitter.once(upstream, "message");
    second.send("still-alive");
    expect((await typed)[0].toString()).toBe("still-alive");
    const changed = Buffer.from([79, 66, 86, 49, 0, 0, 0, 8, 2, 128, 1, 224, 255, 216, 255, 217]);
    const changedB = NodeEvents.EventEmitter.once(second, "message");
    upstream.send(changed);
    expect([...(await changedB)[0]]).toEqual([...changed]);
    await session.close(b.id);
    expect(deleted).toEqual(["/v1/browser/view/sessions/physical-1"]);
    expect(peers.size).toBe(0);
  } finally {
    await Promise.all(leases.map((id) => session.close(id)));
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("waits for the previous tab's physical cleanup before creating its replacement", async () => {
  const deleting = Promise.withResolvers<void>();
  const deleted = Promise.withResolvers<void>();
  let creates = 0;
  const session = createBrowserSession({
    origin: "http://127.0.0.1:12345",
    token: "owner",
    peers: new Set(),
    isClosed: () => false,
    request: async (_path, method) => {
      if (method === "DELETE") {
        deleting.resolve();
        await deleted.promise;
        return null;
      }
      const id = `physical-${++creates}`;
      return { id, tabId: "tab", streamPath: `/v1/browser/view/sessions/${id}/stream` };
    },
  });
  const first = await session.create("tab");
  const closing = session.close(first.id);
  await deleting.promise;
  const replacement = session.create("tab");
  expect(creates).toBe(1);
  deleted.resolve();
  await closing;
  const next = await replacement;
  expect(next.id).not.toBe(first.id);
  expect(creates).toBe(2);
  await session.close(next.id);
});

it("cleans up a physical creation completed after owner logout without issuing a viewer lease", async () => {
  const creating = Promise.withResolvers<void>();
  const created = Promise.withResolvers<unknown>();
  const deleted = Promise.withResolvers<string>();
  const peers = new Set<() => void>();
  let closed = false;
  const session = createBrowserSession({
    origin: "http://127.0.0.1:12345",
    token: "owner",
    peers,
    isClosed: () => closed,
    request: async (path, method) => {
      if (method === "DELETE") {
        deleted.resolve(path);
        return null;
      }
      creating.resolve();
      return created.promise;
    },
  });
  const pending = session.create("tab");
  const rejected = expect(pending).rejects.toThrow("Browser host closed");
  await creating.promise;
  closed = true;
  for (const stop of peers) stop();
  created.resolve({
    id: "late",
    tabId: "tab",
    streamPath: "/v1/browser/view/sessions/late/stream",
  });
  await rejected;
  expect(await deleted.promise).toBe("/v1/browser/view/sessions/late");
  expect(peers.size).toBe(0);
  await expect(session.create("tab")).rejects.toThrow("Browser host closed");
});

it("does not share lease authority across private owner sessions and retries failed creation", async () => {
  let failed = false;
  const deleted: string[] = [];
  const make = () =>
    createBrowserSession({
      origin: "http://127.0.0.1:12345",
      token: "owner",
      peers: new Set(),
      isClosed: () => false,
      request: async (path, method) => {
        if (method === "DELETE") {
          deleted.push(path);
          return null;
        }
        if (!failed) {
          failed = true;
          throw new Error("temporary unavailable");
        }
        return { id: "owned", tabId: "tab", streamPath: "/v1/browser/view/sessions/owned/stream" };
      },
    });
  const a = make();
  const b = make();
  await expect(a.create("tab")).rejects.toThrow("temporary unavailable");
  const lease = await a.create("tab");
  expect(() => b.dial(lease.streamPath)).toThrow("Invalid browser stream");
  await b.close(lease.id);
  expect(deleted).toEqual([]);
  await a.close(lease.id);
  await a.close(lease.id);
  expect(deleted).toEqual(["/v1/browser/view/sessions/owned"]);
});

it("does not replace a physical stream whose stop could not be confirmed", async () => {
  let creates = 0;
  const session = createBrowserSession({
    origin: "http://127.0.0.1:12345",
    token: "owner",
    peers: new Set(),
    isClosed: () => false,
    request: async (_path, method) => {
      if (method === "DELETE") throw new Error("stop unconfirmed");
      creates++;
      return { id: "owned", tabId: "tab", streamPath: "/v1/browser/view/sessions/owned/stream" };
    },
  });
  const lease = await session.create("tab");
  await expect(session.close(lease.id)).rejects.toThrow("stop unconfirmed");
  await expect(session.create("tab")).rejects.toThrow("stop unconfirmed");
  expect(creates).toBe(1);
});

it("connects only the owned released stream with a private token and preserves OBV1 binary frames", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const peers = new Set<() => void>();
  const deleted: string[] = [];
  const session = createBrowserSession({
    origin: `http://127.0.0.1:${address.port}`,
    token: "private-owner",
    peers,
    isClosed: () => false,
    request: async (path, method) => {
      if (method === "DELETE") {
        deleted.push(path);
        return null;
      }
      return {
        id: "owned",
        tabId: "tab",
        streamPath: "/v1/browser/view/sessions/owned/stream",
      };
    },
  });
  try {
    expect(() => session.dial("//evil.test/v1/browser/view/sessions/owned/stream")).toThrow();
    let now = 1000;
    const views = new BrowserViews({
      now: () => now,
      authorize: async () => {},
      create: async (_hostId, tabId) => ({ session, upstream: await session.create(tabId) }),
    });
    const grant = await views.open("alice", "host", "tab");
    const connection = NodeEvents.EventEmitter.once(server, "connection");
    const socket = await views.connect("alice", "host", grant.id, grant.token);
    const [host, request] = await connection;
    expect(request.headers["sec-websocket-protocol"]).toBe("openbot-token.private-owner");
    expect(request.url).toBe("/v1/browser/view/sessions/owned/stream");
    await NodeEvents.EventEmitter.once(socket, "open");
    now = grant.expiresAt;
    await expect(views.check("alice", "host", grant.id)).resolves.toBeUndefined();
    const received = NodeEvents.EventEmitter.once(socket, "message");
    // Independently specified OBV1: seq 7, width 640, height 480, JPEG marker bytes.
    host.send(Buffer.from([79, 66, 86, 49, 0, 0, 0, 7, 2, 128, 1, 224, 255, 216, 255, 217]));
    const [bytes, binary] = await received;
    expect(binary).toBe(true);
    const frame = decodeBrowserViewFrame(bytes);
    expect([frame.sequence, frame.width, frame.height]).toEqual([7, 640, 480]);
    expect([...frame.image]).toEqual([255, 216, 255, 217]);
    const input = decodeBrowserViewInput(
      '{"type":"pointer","action":"down","x":0.5,"y":0.25,"sequence":7,"button":"left"}',
    );
    expect(browserViewInputForHost(input, false, false)).toEqual({
      type: "pointer",
      action: "down",
      x: 0.5,
      y: 0.25,
      button: "left",
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    });
    expect(() =>
      decodeBrowserViewInput('{"type":"pointer","action":"down","x":2,"y":0,"button":"left"}'),
    ).toThrow();
    expect(() => decodeBrowserViewFrame(new Uint8Array([1, 2, 3]))).toThrow();
    const closed = NodeEvents.EventEmitter.once(socket, "close");
    await views.revoke("alice");
    await closed;
    expect(deleted).toEqual(["/v1/browser/view/sessions/owned"]);
    await expect(views.connect("alice", "host", grant.id, grant.token)).rejects.toThrow();
    expect(peers.size).toBe(0);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
