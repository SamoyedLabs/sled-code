// @effect-diagnostics nodeBuiltinImport:off - Local WebSocket fixtures exercise the released upstream transport.
import * as NodeWS from "@effect/platform-node/NodeWS";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as EventStream from "./EventStream.ts";

const identity = { requestId: "request1", botId: "bot1", threadId: "thread1", turnId: "turn1" };
const emptySnapshot = {
  attentionComplete: true,
  pendingPrompts: [],
  pendingApprovals: [],
  pendingBrowserTakeovers: [],
};
const fixture = Effect.fnUntraced(function* (
  onConnection: (socket: NodeWS.WebSocket, request: import("node:http").IncomingMessage) => void,
) {
  const server = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new NodeWS.WebSocketServer({
          port: 0,
          host: "127.0.0.1",
          handleProtocols: (protocols) =>
            protocols.has("openbot-team-v1") ? "openbot-team-v1" : false,
        }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) client.terminate();
            server.close(() => resolve());
          }),
      ),
  );
  server.on("connection", onConnection);
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* Effect.die("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
});

it.live(
  "negotiates the released event protocol and projects real attention without private event fields",
  () =>
    Effect.gen(function* () {
      const peers = new Set<() => void>();
      let scope: unknown;
      const origin = yield* fixture((socket, request) => {
        expect(request.url).toBe("/v1/events");
        expect(request.headers["sec-websocket-protocol"]).toBe(
          "openbot-team-v1,openbot-token.private-session",
        );
        expect(request.headers["openbot-protocol-version"]).toBe("9");
        socket.once("message", (data) => {
          scope = JSON.parse(data.toString());
          socket.send(
            JSON.stringify({
              type: "runtime-snapshot",
              snapshot: {
                ...emptySnapshot,
                mcpServers: [{ env: { TOKEN: "private-config" } }],
                pendingApprovals: [
                  {
                    ...identity,
                    kind: "command",
                    command: "git status",
                    cwd: "/workspace/project",
                    reason: "Inspect work before editing",
                    grantRoot: null,
                    permissions: {
                      fileSystem: { read: ["/workspace/project"], write: [] },
                      network: false,
                    },
                    truncated: false,
                    providerPrivateState: "private-provider-state",
                  },
                ],
                pendingPrompts: [
                  {
                    ...identity,
                    requestId: 2,
                    questions: [
                      {
                        id: "q1",
                        isSecret: true,
                        header: "API key",
                        question: "Enter the API key for your connector",
                        options: null,
                        privateAnswer: "private-answer",
                      },
                    ],
                  },
                ],
                pendingBrowserTakeovers: [
                  {
                    ...identity,
                    requestId: 3,
                    tabId: "tab1",
                    reason: "sign-in-blocked",
                    secret: {
                      method: "password",
                      origin: "https://example.com",
                      digits: 6,
                      password: "private-password",
                    },
                  },
                ],
              },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "mcp-servers-changed",
              configs: [{ token: "private-mcp-token" }],
            }),
          );
        });
      });
      const frames = yield* EventStream.connect({
        origin,
        sessionToken: "private-session",
        isClosed: () => false,
        peers,
      }).pipe(Stream.take(2), Stream.runCollect);
      expect(scope).toMatchObject({
        type: "agent-event-scope",
        includeConversations: false,
        capabilities: expect.arrayContaining(["agent-runtime-snapshots", "agent-tasks-v1"]),
      });
      expect(frames).toEqual([
        {
          type: "snapshot",
          complete: true,
          requests: [
            {
              kind: "approval",
              requestId: "request1",
              agentId: "bot1",
              threadId: "thread1",
              turnId: "turn1",
              approvalKind: "command",
              approval: {
                command: "git status",
                cwd: "/workspace/project",
                reason: "Inspect work before editing",
                grantRoot: null,
                permissions: {
                  fileSystem: { read: ["/workspace/project"], write: [] },
                  network: false,
                },
                truncated: false,
              },
            },
            {
              kind: "prompt",
              requestId: 2,
              agentId: "bot1",
              threadId: "thread1",
              turnId: "turn1",
              questions: [
                {
                  id: "q1",
                  isSecret: true,
                  header: "API key",
                  question: "Enter the API key for your connector",
                  options: null,
                },
              ],
            },
            {
              kind: "takeover",
              requestId: 3,
              tabId: "tab1",
              takeoverReason: "sign-in-blocked",
              browserSecret: { method: "password", origin: "https://example.com", digits: 6 },
              agentId: "bot1",
              threadId: "thread1",
              turnId: "turn1",
            },
          ],
        },
        { type: "change", resource: "configuration" },
      ]);
      expect(JSON.stringify(frames)).not.toContain("private-");
      expect(peers.size).toBe(0);
    }).pipe(Effect.scoped),
);

it.live("requests authoritative attention recovery when a pending input resolves", () =>
  Effect.gen(function* () {
    const origin = yield* fixture((socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({ type: "agent-input-resolved", kind: "approval", ...identity }),
        );
        socket.once("message", (data) => {
          expect(JSON.parse(data.toString())).toEqual({ type: "runtime-snapshot-request" });
          socket.send(
            JSON.stringify({
              type: "runtime-snapshot",
              snapshot: { ...emptySnapshot, attentionComplete: false },
            }),
          );
        });
      });
    });
    expect(
      yield* EventStream.connect({
        origin,
        sessionToken: "token",
        isClosed: () => false,
        peers: new Set(),
      }).pipe(Stream.take(1), Stream.runCollect),
    ).toEqual([{ type: "snapshot", complete: false, requests: [] }]);
  }).pipe(Effect.scoped),
);

it.live.each(["malformed", "binary", "oversized"])(
  "rejects %s frames without exposing their payload",
  (mode) =>
    Effect.gen(function* () {
      const origin = yield* fixture((socket) =>
        socket.once("message", () => {
          if (mode === "binary") socket.send(Buffer.from("private-payload"));
          else
            socket.send(
              mode === "oversized"
                ? "private-payload".repeat(22000)
                : '{"type":"runtime-snapshot","snapshot":"private-payload"}',
            );
        }),
      );
      const error = yield* EventStream.connect({
        origin,
        sessionToken: "token",
        isClosed: () => false,
        peers: new Set(),
      }).pipe(Stream.runDrain, Effect.flip);
      expect(error).toBeInstanceOf(EventStream.EventStreamError);
      expect(JSON.stringify(error)).not.toContain("private-payload");
    }).pipe(Effect.scoped),
);

it.live(
  "closes an overflowing stream so reconnect can recover rather than silently losing invalidations",
  () =>
    Effect.gen(function* () {
      const blocked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let peer: NodeWS.WebSocket | undefined;
      let closed: Promise<void> | undefined;
      const origin = yield* fixture((socket) => {
        peer = socket;
        closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
        socket.once("message", () =>
          socket.send(JSON.stringify({ type: "runtime-snapshot", snapshot: emptySnapshot })),
        );
      });
      const fiber = yield* EventStream.connect({
        origin,
        sessionToken: "token",
        isClosed: () => false,
        peers: new Set(),
      }).pipe(
        Stream.tap(() =>
          Deferred.succeed(blocked, undefined).pipe(Effect.andThen(Deferred.await(release))),
        ),
        Stream.runDrain,
        Effect.flip,
        Effect.forkScoped,
      );
      yield* Deferred.await(blocked);
      yield* Effect.sync(() => {
        for (let index = 0; index < 200; index++)
          peer?.send('{"type":"conversation-invalidated","botId":"bot1","revision":1}');
      });
      yield* Effect.promise(() => closed ?? Promise.reject(new Error("Missing peer")));
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(fiber)).reason).toBe("overflow");
    }).pipe(Effect.scoped),
);
