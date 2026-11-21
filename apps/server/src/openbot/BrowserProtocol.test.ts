import { BrowserFrameDelivery, BrowserHeldInput } from "./BrowserProtocol.ts";
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
    const upstream = await physical.promise;
    const forwarded: unknown[] = [];
    const cleaned = Promise.withResolvers<void>();
    upstream.on("message", (bytes) => {
      forwarded.push(JSON.parse(bytes.toString()));
      if (forwarded.length === 10) cleaned.resolve();
    });
    const key = (action: "down" | "up" | "char", value = "Shift") => ({
      type: "key",
      action,
      key: value,
      code: value === "Shift" ? "ShiftLeft" : "KeyS",
      text: action === "char" ? value : "",
      modifiers: action === "up" ? 0 : 8,
    });
    const pointer = (action: "down" | "up" | "move", button: "left" | "middle", x = 0.2) => ({
      type: "pointer",
      action,
      button,
      x,
      y: 0.3,
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    });
    const send = async (peer: typeof first, input: unknown) => {
      const received = NodeEvents.EventEmitter.once(upstream, "message");
      peer.send(JSON.stringify(input));
      expect(JSON.parse((await received)[0].toString())).toEqual(input);
    };
    await send(first, key("down"));
    await send(first, pointer("down", "left"));
    expect(() => second.send(JSON.stringify(key("down")))).toThrow("another viewer");
    expect(() => second.send(JSON.stringify(pointer("down", "middle")))).toThrow("another viewer");
    expect(second.readyState).toBe(1);
    await send(first, key("up"));
    expect(() => second.send(JSON.stringify(key("char", "s")))).toThrow("another viewer");
    await send(first, pointer("up", "left"));
    await send(second, key("down"));
    await send(second, pointer("down", "middle"));
    await send(second, pointer("move", "middle", 0.8));
    await session.close(a.id);
    expect(deleted).toEqual([]);
    await send(second, key("char", "s"));
    expect(forwarded).toHaveLength(8);
    const changed = Buffer.from([79, 66, 86, 49, 0, 0, 0, 8, 2, 128, 1, 224, 255, 216, 255, 217]);
    const changedB = NodeEvents.EventEmitter.once(second, "message");
    upstream.send(changed);
    expect([...(await changedB)[0]]).toEqual([...changed]);
    await session.close(b.id);
    await cleaned.promise;
    expect(forwarded.slice(8)).toEqual([
      pointer("up", "middle", 0.8),
      { ...key("up"), modifiers: 0 },
    ]);
    expect(deleted).toEqual(["/v1/browser/view/sessions/physical-1"]);
    expect(peers.size).toBe(0);
    const after = await session.create("tab");
    leases.push(after.id);
    const connected = NodeEvents.EventEmitter.once(server, "connection");
    const final = session.dial(after.streamPath);
    await NodeEvents.EventEmitter.once(final, "message");
    const [lastHost] = await connected;
    const down = NodeEvents.EventEmitter.once(lastHost, "message");
    final.send(JSON.stringify(key("down")));
    expect(JSON.parse((await down)[0].toString())).toEqual(key("down"));
    const released = NodeEvents.EventEmitter.once(lastHost, "message");
    for (const stop of peers) stop();
    expect(JSON.parse((await released)[0].toString())).toEqual(key("up"));
    await session.close(after.id);
    expect(deleted).toEqual([
      "/v1/browser/view/sessions/physical-1",
      "/v1/browser/view/sessions/physical-2",
    ]);
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

it("bounds each acknowledged viewer to a drawing frame and the newest pending frame", () => {
  const delivery = new BrowserFrameDelivery(true);
  const first = new Uint8Array([1]);
  const latest = new Uint8Array([3]);
  expect(delivery.offer(1, first)).toBe(first);
  expect(delivery.offer(2, new Uint8Array([2]))).toBeUndefined();
  expect(delivery.offer(3, latest)).toBeUndefined();
  expect(delivery.acknowledge(99)).toBeUndefined();
  expect(delivery.drawnSequence).toBeUndefined();
  expect(delivery.acknowledge(1)).toBe(latest);
  expect(delivery.drawnSequence).toBe(1);
  expect(delivery.acknowledge(1)).toBeUndefined();
  expect(delivery.acknowledge(3)).toBeUndefined();
  expect(delivery.drawnSequence).toBe(3);
  expect(delivery.offer(4, first)).toBe(first);
  const other = new BrowserFrameDelivery(true);
  expect(other.offer(1, latest)).toBe(latest);
  const legacy = new BrowserFrameDelivery(false);
  expect(legacy.offer(1, first)).toBe(first);
  expect(legacy.offer(2, latest)).toBe(latest);
});

it("releases only this viewer's held controls at the last drag position without replaying text", () => {
  const held = new BrowserHeldInput();
  held.record(
    decodeBrowserViewInput(
      '{"type":"pointer","action":"down","x":0.1,"y":0.2,"sequence":4,"button":"right"}',
    ),
  );
  held.record(
    decodeBrowserViewInput('{"type":"pointer","action":"move","x":0.8,"y":0.9,"button":"right"}'),
  );
  held.record(
    decodeBrowserViewInput(
      '{"type":"key","action":"down","key":"Shift","code":"ShiftLeft","text":"","modifiers":8}',
    ),
  );
  held.record(
    decodeBrowserViewInput(
      '{"type":"key","action":"char","key":"a","code":"KeyA","text":"a","modifiers":8}',
    ),
  );
  expect(held.release()).toEqual([
    {
      type: "pointer",
      action: "up",
      x: 0.8,
      y: 0.9,
      button: "right",
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    },
    { type: "key", action: "up", key: "Shift", code: "ShiftLeft", text: "", modifiers: 0 },
  ]);
  expect(held.release()).toEqual([]);
});

it("routes page copy and context menus only to their requesting viewer, including a closed pending owner", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const physical = Promise.withResolvers<import("@effect/platform-node/NodeWS").WebSocket>();
  let query = "";
  server.on("connection", (socket, request) => {
    query = request.url ?? "";
    socket.send(Buffer.from([79, 66, 86, 49, 0, 0, 0, 1, 2, 128, 1, 224, 255, 216, 255, 217]));
    physical.resolve(socket);
  });
  const session = createBrowserSession({
    origin: `http://127.0.0.1:${address.port}`,
    token: "owner",
    peers: new Set(),
    isClosed: () => false,
    request: async (_path, method) =>
      method === "DELETE"
        ? null
        : {
            id: "physical-private",
            tabId: "tab",
            streamPath: "/v1/browser/view/sessions/physical-private/stream",
          },
  });
  const features = { clipboard: true, cursor: true, contextMenu: true };
  const a = await session.create("tab", features);
  const b = await session.create("tab", features);
  const first = session.dial(a.streamPath);
  await NodeEvents.EventEmitter.once(first, "message");
  const second = session.dial(b.streamPath);
  await NodeEvents.EventEmitter.once(second, "message");
  const socket = await physical.promise;
  const seenA: unknown[] = [],
    seenB: unknown[] = [];
  first.on("message", (raw, binary) => {
    if (!binary) seenA.push(JSON.parse(raw.toString()));
  });
  second.on("message", (raw, binary) => {
    if (!binary) seenB.push(JSON.parse(raw.toString()));
  });
  const barrier = () => {
    const aa = NodeEvents.EventEmitter.once(first, "message");
    const bb = NodeEvents.EventEmitter.once(second, "message");
    socket.send('{"type":"cursor","cursor":"pointer"}');
    return Promise.all([aa, bb]);
  };
  try {
    expect(query).toContain("cursor=1");
    expect(query).toContain("menu=1");
    expect(a.features).toEqual(features);
    let input = NodeEvents.EventEmitter.once(socket, "message");
    first.send('{"type":"copy"}');
    await input;
    expect(() => second.send('{"type":"copy"}')).toThrow("pending");
    socket.send('{"type":"copied","text":"first-view-owned-content"}');
    await barrier();
    expect(seenA).toContainEqual({ type: "copied", text: "first-view-owned-content" });
    expect(seenB).not.toContainEqual({ type: "copied", text: "first-view-owned-content" });
    input = NodeEvents.EventEmitter.once(socket, "message");
    first.send(
      JSON.stringify({
        type: "pointer",
        action: "down",
        button: "right",
        x: 0.5,
        y: 0.5,
        clickCount: 1,
        deltaX: 0,
        deltaY: 0,
        modifiers: 0,
      }),
    );
    await input;
    socket.send(
      JSON.stringify({
        type: "context-menu",
        items: ["copy-link"],
        link: "https://owned-fixture.invalid/private-link",
      }),
    );
    await barrier();
    expect(seenA).toContainEqual({
      type: "context-menu",
      items: ["copy-link"],
      link: "https://owned-fixture.invalid/private-link",
    });
    expect(seenB).not.toContainEqual({
      type: "context-menu",
      items: ["copy-link"],
      link: "https://owned-fixture.invalid/private-link",
    });
    input = NodeEvents.EventEmitter.once(socket, "message");
    first.send('{"type":"copy"}');
    await input;
    await session.close(a.id);
    expect(() => second.send('{"type":"copy"}')).toThrow("pending");
    const bb = NodeEvents.EventEmitter.once(second, "message");
    socket.send('{"type":"copied","text":"closed-view-private-content"}');
    socket.send('{"type":"cursor","cursor":"text"}');
    await bb;
    expect(seenB).not.toContainEqual({ type: "copied", text: "closed-view-private-content" });
    input = NodeEvents.EventEmitter.once(socket, "message");
    second.send('{"type":"copy"}');
    await input;
    const copied = NodeEvents.EventEmitter.once(second, "message");
    socket.send('{"type":"copied","text":"second-view-owned-content"}');
    await copied;
    expect(seenB).toContainEqual({ type: "copied", text: "second-view-owned-content" });
  } finally {
    await session.close(a.id);
    await session.close(b.id);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("forwards frame-point negotiation and refuses a pooled viewer pointing behind the upstream retention floor", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const physical = Promise.withResolvers<import("@effect/platform-node/NodeWS").WebSocket>();
  server.on("connection", (peer, request) => {
    expect(new URL(request.url!, "http://test").searchParams.get("frameAck")).toBe("1");
    physical.resolve(peer);
    peer.send(Buffer.from([79, 66, 86, 49, 0, 0, 0, 7, 2, 128, 1, 224, 255, 216, 255, 217]));
  });
  const session = createBrowserSession({
    origin: `http://127.0.0.1:${address.port}`,
    token: "owner",
    peers: new Set(),
    isClosed: () => false,
    request: async (_path, method) =>
      method === "POST"
        ? { id: "physical", tabId: "tab", streamPath: "/v1/browser/view/sessions/physical/stream" }
        : null,
  });
  const features = {
    framePoint: true,
    clipboard: false,
    cursor: false,
    contextMenu: false,
    viewport: { width: 1280, height: 800 },
  };
  const a = await session.create("tab", features),
    b = await session.create("tab", features);
  try {
    await expect(
      session.create("tab", { ...features, viewport: { width: 800, height: 600 } }),
    ).rejects.toThrow("viewport");
    const first = session.dial(a.streamPath);
    await NodeEvents.EventEmitter.once(first, "message");
    const second = session.dial(b.streamPath);
    await NodeEvents.EventEmitter.once(second, "message");
    const host = await physical.promise;
    const ack = NodeEvents.EventEmitter.once(host, "message");
    first.send(JSON.stringify({ type: "ack", sequence: 7 }));
    second.send(JSON.stringify({ type: "ack", sequence: 7 }));
    expect(JSON.parse((await ack)[0].toString())).toEqual({ type: "ack", sequence: 7 });
    const pointer = {
      type: "pointer",
      action: "move",
      sequence: 8,
      x: 0.5,
      y: 0.5,
      button: "left",
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    };
    const next = NodeEvents.EventEmitter.once(first, "message");
    host.send(Buffer.from([79, 66, 86, 49, 0, 0, 0, 8, 5, 0, 3, 32, 255, 216, 255, 217]));
    await next;
    const input = NodeEvents.EventEmitter.once(host, "message");
    first.send(JSON.stringify(pointer));
    expect(JSON.parse((await input)[0].toString())).toEqual(pointer);
    expect(() => second.send(JSON.stringify({ ...pointer, sequence: 7 }))).toThrow(
      "no longer retained",
    );
    for (let sequence = 9; sequence <= 109; sequence++) {
      const received = NodeEvents.EventEmitter.once(first, "message");
      const bytes = Buffer.from([79, 66, 86, 49, 0, 0, 0, 0, 5, 0, 3, 32, 255, 216, 255, 217]);
      bytes.writeUInt32BE(sequence, 4);
      host.send(bytes);
      await received;
      first.send(JSON.stringify({ type: "ack", sequence }));
    }
    expect(first.readyState).toBe(1);
    expect(second.readyState).toBe(3);
  } finally {
    await session.close(a.id);
    await session.close(b.id);
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
