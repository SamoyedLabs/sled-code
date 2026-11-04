import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { WebSocket, WebSocketServer } from "@effect/platform-node/NodeWS";
import { expect, it } from "@effect/vitest";
import { AuthPreviewOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter, HttpServer } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as Integration from "./Integration.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";
import * as Gateway from "./BrowserViewGateway.ts";
import { routeLayer } from "./browserViewHttp.ts";

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const authLayer = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(Config.layerTest(process.cwd(), { prefix: "openbot-view-gateway-" })),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.effect.each([401, 503])(
  "renews an initialized expired owner only for an explicit create rejection (%s)",
  (status) =>
    Effect.gen(function* () {
      let logins = 0;
      let posts = 0;
      let expired = false;
      const closed: string[] = [];
      const ready: ManagedHost.HostReady = {
        serverId: "host",
        serverName: "Bots",
        apiUrl: "http://127.0.0.1:8080",
        fingerprint: "fp",
        publicKey: "key",
        ownerMemberId: "owner",
      };
      const integration = Integration.layerWithHost("secret").pipe(
        Layer.provide(
          Layer.mock(ManagedHost.ManagedHost, {
            getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
            changes: Stream.never,
          }),
        ),
        Layer.provide(
          Layer.mock(TeamClient.TeamClient, {
            connect: () =>
              Effect.sync(() => {
                const epoch = ++logins;
                return {
                  events: Stream.never,
                  listAgents: Effect.succeed([]),
                  close: Effect.void,
                  apiRead: () => Effect.succeed(null),
                  apiWrite: () => Effect.succeed(null),
                  apiAdmin: () => Effect.succeed(null),
                  files: {
                    listWorkspace: () => Effect.die("unused"),
                    search: () => Effect.die("unused"),
                    attachment: () => Effect.die("unused"),
                    sentAttachments: () => Effect.die("unused"),
                    download: () => Effect.die("unused"),
                    upload: () => Effect.die("unused"),
                    send: () => Effect.die("unused"),
                    discard: () => Effect.die("unused"),
                  },
                  browser: {
                    create: async (tabId: string) => {
                      posts++;
                      if (expired && epoch === 1)
                        throw new TeamClient.TeamClientError({ reason: "http", status });
                      return {
                        id: `epoch-${epoch}`,
                        tabId,
                        streamPath: `/v1/browser/view/sessions/epoch-${epoch}/stream`,
                      };
                    },
                    close: async (id: string) => {
                      closed.push(`${epoch}:${id}`);
                    },
                    dial: () => {
                      throw new Error("unused");
                    },
                  },
                };
              }),
          }),
        ),
      );
      const services = yield* Layer.build(
        Gateway.layer.pipe(Layer.provide(integration), Layer.provideMerge(authLayer)),
      );
      const gateway = Context.get(services, Gateway.BrowserViewGateway);
      const owner = yield* Context.get(services, SessionStore.SessionStore).issue({
        subject: "owner",
        scopes: [AuthSettingsWriteScope, AuthPreviewOperateScope],
      });
      const first = yield* gateway.command(owner.sessionId, {
        operation: "open",
        hostId: "host",
        tabId: "tab",
      });
      if (!first) throw new Error("Missing initial grant");
      yield* gateway.command(owner.sessionId, { operation: "close", hostId: "host", id: first.id });
      expired = true;
      const opened = yield* gateway
        .command(owner.sessionId, { operation: "open", hostId: "host", tabId: "tab" })
        .pipe(Effect.result);
      if (status === 401) {
        expect(opened._tag).toBe("Success");
        expect(logins).toBe(2);
        expect(posts).toBe(3);
        if (opened._tag === "Success" && opened.success)
          yield* gateway.command(owner.sessionId, {
            operation: "close",
            hostId: "host",
            id: opened.success.id,
          });
        expect(closed).toEqual(["1:epoch-1", "2:epoch-2"]);
      } else {
        expect(opened._tag).toBe("Failure");
        expect(logins).toBe(1);
        expect(posts).toBe(2);
        expect(closed).toEqual(["1:epoch-1"]);
      }
    }).pipe(Effect.scoped),
);

it.effect(
  "streams authenticated binary frames while enforcing principal, host, one-use, expiry and current authority",
  () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.sync(() => new WebSocketServer({ host: "127.0.0.1", port: 0 })),
        (server) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                for (const peer of server.clients) peer.terminate();
                server.close(() => resolve());
              }),
          ),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => host.once("listening", resolve)));
      const address = host.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture port");
      const frame = Buffer.from([79, 66, 86, 49, 0, 0, 0, 7, 2, 128, 1, 224, 255, 216, 255, 217]);
      const closed: string[] = [];
      let count = 0;
      let currentHost: string | null = "host";
      const hostChanges = yield* PubSub.unbounded<string | null>();
      const upstreamReady = Promise.withResolvers<WebSocket>();
      host.on("connection", (peer) => {
        upstreamReady.resolve(peer);
        peer.send(frame);
      });
      const integration = Layer.mock(Integration.Integration, {
        readyHostId: Effect.sync(() => currentHost),
        readyChanges: Stream.concat(Stream.make("host"), Stream.fromPubSub(hostChanges)),
        withBrowserToHost: (_hostId, use) =>
          use({
            create: async (tabId) => {
              const id = `owned-${++count}`;
              return { id, tabId, streamPath: `/v1/browser/view/sessions/${id}/stream` };
            },
            close: async (id) => {
              closed.push(id);
            },
            dial: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
          }).pipe(
            Effect.mapError(
              (cause) =>
                new Integration.IntegrationError({
                  message: "Fixture browser request failed.",
                  cause,
                }),
            ),
          ),
      });
      const services = yield* Layer.build(
        Layer.mergeAll(
          Gateway.layer,
          HttpRouter.serve(routeLayer.pipe(Layer.provide(Gateway.layer)), {
            disableListenLog: true,
          }).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
        ).pipe(Layer.provide(integration), Layer.provideMerge(authLayer)),
      );
      const gateway = Context.get(services, Gateway.BrowserViewGateway);
      const sessions = Context.get(services, SessionStore.SessionStore);
      const alice = yield* sessions.issue({
        subject: "alice",
        scopes: [AuthSettingsWriteScope, AuthPreviewOperateScope],
      });
      const bob = yield* sessions.issue({
        subject: "bob",
        scopes: [AuthSettingsWriteScope, AuthPreviewOperateScope],
      });
      const reader = yield* sessions.issue({ subject: "reader", scopes: [AuthSettingsWriteScope] });
      expect(
        yield* gateway
          .command(reader.sessionId, { operation: "open", hostId: "host", tabId: "tab" })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "authorization" });
      const grant = yield* gateway.command(alice.sessionId, {
        operation: "open",
        hostId: "host",
        tabId: "tab",
      });
      if (!grant) throw new Error("Expected viewer grant");
      const origin = HttpServer.formatAddress(
        Context.get(services, HttpServer.HttpServer).address,
      ).replace(/^http/, "ws");
      const refused = (path: string, bearer: string, viewerToken = grant.token) =>
        Effect.acquireUseRelease(
          Effect.sync(
            () =>
              new WebSocket(`${origin}${path}`, [`sled-browser-view.${viewerToken}`], {
                headers: { Authorization: `Bearer ${bearer}` },
              }),
          ),
          (peer) =>
            Effect.promise(
              () =>
                new Promise<number>((resolve) => {
                  peer.once("unexpected-response", (_request, response) => {
                    response.resume();
                    resolve(response.statusCode ?? 0);
                  });
                  peer.once("open", () => resolve(101));
                  peer.once("error", () => resolve(0));
                }),
            ),
          (peer) => Effect.sync(() => peer.terminate()),
        );
      expect(yield* refused(`/api/openbot/browser-view/host/${grant.id}`, bob.token)).toBe(403);
      expect(yield* refused(`/api/openbot/browser-view/another/${grant.id}`, alice.token)).toBe(
        403,
      );
      expect(
        yield* refused(`/api/openbot/browser-view/host/${grant.id}`, alice.token, "0".repeat(64)),
      ).toBe(403);
      const received = Promise.withResolvers<Buffer>();
      const ended = Promise.withResolvers<void>();
      const peer = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(
              `${origin}/api/openbot/browser-view/host/${grant.id}`,
              [`sled-browser-view.${grant.token}`],
              { headers: { Authorization: `Bearer ${alice.token}` } },
            ),
        ),
        (peer) => Effect.sync(() => peer.close()),
      );
      peer.once("error", received.reject);
      peer.once("message", (bytes) => received.resolve(Buffer.from(bytes as ArrayBuffer)));
      peer.once("close", () => ended.resolve());
      expect([...(yield* Effect.promise(() => received.promise))]).toEqual([...frame]);
      expect(yield* refused(`/api/openbot/browser-view/host/${grant.id}`, alice.token)).toBe(403);
      const upstream = yield* Effect.promise(() => upstreamReady.promise);
      const input = Promise.withResolvers<string>();
      upstream.once("message", (bytes) => input.resolve(bytes.toString()));
      peer.send('{"type":"key","action":"char","key":"a","code":"KeyA","text":"a","modifiers":0}');
      expect(yield* decodeJson(yield* Effect.promise(() => input.promise))).toEqual({
        type: "key",
        action: "char",
        key: "a",
        code: "KeyA",
        text: "a",
        modifiers: 0,
      });
      for (const action of ["move", "wheel"] as const) {
        const forwarded = Promise.withResolvers<string>();
        upstream.once("message", (bytes) => forwarded.resolve(bytes.toString()));
        peer.send(
          JSON.stringify({
            type: "pointer",
            action,
            x: 0.5,
            y: 0.25,
            sequence: 7,
            button: "left",
            clickCount: 1,
            deltaX: 0,
            deltaY: action === "wheel" ? 120 : 0,
            modifiers: 0,
          }),
        );
        expect(yield* decodeJson(yield* Effect.promise(() => forwarded.promise))).toEqual({
          type: "pointer",
          action,
          x: 0.5,
          y: 0.25,
          button: "left",
          clickCount: 1,
          deltaX: 0,
          deltaY: action === "wheel" ? 120 : 0,
          modifiers: 0,
        });
      }
      yield* sessions.revoke(alice.sessionId);
      yield* Effect.promise(() => ended.promise);
      expect(closed).toEqual(["owned-1"]);
      const expired = yield* gateway.command(bob.sessionId, {
        operation: "open",
        hostId: "host",
        tabId: "tab",
      });
      if (!expired) throw new Error("Expected expiring grant");
      yield* TestClock.adjust("60 seconds");
      expect(
        yield* refused(`/api/openbot/browser-view/host/${expired.id}`, bob.token, expired.token),
      ).toBe(403);
      expect(closed).toEqual(["owned-1", "owned-2"]);
      const fresh = yield* gateway.command(bob.sessionId, {
        operation: "open",
        hostId: "host",
        tabId: "tab",
      });
      if (!fresh) throw new Error("Expected fresh grant");
      const ticket = yield* Context.get(
        services,
        EnvironmentAuth.EnvironmentAuth,
      ).issueWebSocketTicket({ sessionId: bob.sessionId }, { use: "media" });
      const freshReceived = Promise.withResolvers<void>();
      const freshEnded = Promise.withResolvers<void>();
      const freshPeer = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(
              `${origin}/api/openbot/browser-view/host/${fresh.id}?wsTicket=${encodeURIComponent(Redacted.value(ticket.ticket))}`,
              [`sled-browser-view.${fresh.token}`],
            ),
        ),
        (peer) => Effect.sync(() => peer.close()),
      );
      freshPeer.once("error", freshReceived.reject);
      freshPeer.once("message", () => freshReceived.resolve());
      freshPeer.once("close", () => freshEnded.resolve());
      yield* Effect.promise(() => freshReceived.promise);
      currentHost = null;
      yield* PubSub.publish(hostChanges, null);
      yield* Effect.promise(() => freshEnded.promise);
      expect(closed).toEqual(["owned-1", "owned-2", "owned-3"]);
    }).pipe(Effect.scoped),
);
