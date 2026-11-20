import * as ConnectWebhookRouting from "./ConnectWebhookRouting.ts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import type * as EventStream from "./EventStream.ts";
import * as Integration from "./Integration.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";

const unusedFiles: TeamClient.Session["files"] = {
  listWorkspace: () => Effect.die("unused file protocol"),
  search: () => Effect.die("unused file protocol"),
  attachment: () => Effect.die("unused file protocol"),
  sentAttachments: () => Effect.die("unused file protocol"),
  download: () => Effect.die("unused file protocol"),
  upload: () => Effect.die("unused file protocol"),
  send: () => Effect.die("unused file protocol"),
  discard: () => Effect.die("unused file protocol"),
};

const ready: ManagedHost.HostReady = {
  serverId: "host",
  serverName: "Bots",
  apiUrl: "http://127.0.0.1:8080",
  fingerprint: "fingerprint",
  publicKey: "key",
  ownerMemberId: "owner",
};

it.effect("reuses one login across roster refreshes and revokes it on stop", () =>
  Effect.gen(function* () {
    let logins = 0;
    let logouts = 0;
    let initialized = false;
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      yield* service.apiWrite({
        operation: "task.start",
        agentId: "bot",
        text: "Investigate",
        clientMessageId: "message1",
      });
      for (let index = 0; index < 8; index++) yield* service.listAgents;
      yield* service.apiRead({ operation: "conversation.read", agentId: "bot" });
      yield* service.apiAdmin({
        operation: "memory.create",
        agentId: "bot",
        text: "Standing note",
      });
      expect(logins).toBe(1);
      expect(logouts).toBe(0);
      yield* service.stop;
      expect(logouts).toBe(1);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.sync(() => {
            logins++;
            return {
              files: unusedFiles,
              events: Stream.never,
              apiRead: () => Effect.succeed(null),
              apiWrite: () =>
                Effect.suspend(() =>
                  initialized
                    ? Effect.succeed(null)
                    : Effect.fail(new TeamClient.TeamClientError({ reason: "http", status: 503 })),
                ),
              apiAdmin: () => Effect.succeed(null),
              listAgents: Effect.sync(() => {
                initialized = true;
                return [];
              }),
              close: Effect.sync(() => {
                logouts++;
              }),
            };
          }),
      }),
    );
    expect(logouts).toBe(1);
  }),
);

it.effect("does not invalidate stopped-host reads in response to their own refusal", () =>
  Effect.gen(function* () {
    const service = yield* Integration.Integration;
    const events: unknown[] = [];
    yield* service.subscribeChanges.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    const before = events.length;
    for (let index = 0; index < 20; index++) {
      expect((yield* Effect.flip(service.listAgents)).message).toBe(
        "The Openbot host is not ready.",
      );
      yield* Effect.yieldNow;
    }
    expect(events.length).toBe(before);
  }).pipe(
    Effect.provide(Integration.layerWithHost("owner-secret")),
    Effect.provideService(ManagedHost.ManagedHost, {
      changes: Stream.never,
      switchExecutable: () => Effect.die("unused executable switch"),
      getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "stopped" }),
      start: Effect.succeed(ready),
      stop: Effect.void,
    }),
    Effect.provideService(TeamClient.TeamClient, {
      connect: () => Effect.die("Stopped engine must not connect"),
    }),
  ),
);

it.effect("reconnects once when the host rejects an expired session", () =>
  Effect.gen(function* () {
    let logins = 0;
    let logouts = 0;
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      expect(yield* service.listAgents).toEqual([{ id: "bot", name: "School", provider: "codex" }]);
      expect(logins).toBe(2);
      expect(logouts).toBe(1);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.sync(() => {
            logins++;
            return {
              files: unusedFiles,
              events: Stream.never,
              apiRead: () => Effect.succeed(null),
              apiWrite: () => Effect.succeed(null),
              apiAdmin: () => Effect.succeed(null),
              listAgents:
                logins === 1
                  ? Effect.fail(new TeamClient.TeamClientError({ reason: "http", status: 401 }))
                  : Effect.succeed([{ id: "bot", name: "School", provider: "codex" }]),
              close: Effect.sync(() => {
                logouts++;
              }),
            };
          }),
      }),
    );
    expect(logouts).toBe(2);
  }),
);

it.effect("keeps an unconfigured engine disabled and rejects listing without connecting", () =>
  Effect.gen(function* () {
    const service = yield* Integration.Integration;
    expect(yield* service.status).toEqual({ state: "disabled" });
    expect((yield* Effect.flip(service.listAgents)).message).toBe("The Openbot host is not ready.");
    expect((yield* Effect.flip(service.start)).message).toBe(
      "Unable to start the configured Openbot host.",
    );
  }).pipe(
    Effect.provide(Integration.layerWithHost(undefined)),
    Effect.provideService(ManagedHost.ManagedHost, {
      changes: Stream.never,
      switchExecutable: () => Effect.die("unused executable switch"),
      getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "disabled" }),
      start: Effect.fail(new ManagedHost.ManagedHostError({ reason: "disabled" })),
      stop: Effect.void,
    }),
    Effect.provideService(TeamClient.TeamClient, {
      connect: () => Effect.die("Disabled engine must not connect"),
    }),
  ),
);

it.effect.each([false, true])(
  "releases the authenticated session after roster request (failure=%s)",
  (fail) =>
    Effect.gen(function* () {
      let closed = false;
      const result = yield* Effect.gen(function* () {
        const service = yield* Integration.Integration;
        expect(yield* service.status).toEqual({ state: "ready", hostId: "host" });
        return yield* service.listAgents;
      }).pipe(
        Effect.provide(Integration.layerWithHost("owner-secret")),
        Effect.provideService(ManagedHost.ManagedHost, {
          changes: Stream.never,
          switchExecutable: () => Effect.die("unused executable switch"),
          getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
          start: Effect.succeed(ready),
          stop: Effect.void,
        }),
        Effect.provideService(TeamClient.TeamClient, {
          connect: (input) => {
            expect(input).toEqual({ apiUrl: ready.apiUrl, ownerSecret: "owner-secret" });
            return Effect.succeed({
              files: unusedFiles,
              events: Stream.never,
              apiRead: () => Effect.succeed(null),
              apiWrite: () => Effect.succeed(null),
              apiAdmin: () => Effect.succeed(null),
              listAgents: fail
                ? Effect.fail(new TeamClient.TeamClientError({ reason: "http", status: 403 }))
                : Effect.succeed([{ id: "bot", name: "School", provider: "codex" }]),
              close: Effect.sync(() => {
                closed = true;
              }),
            });
          },
        }),
        Effect.match({ onSuccess: (agents) => agents, onFailure: (error) => error.message }),
      );
      expect(closed).toBe(true);
      expect(result).toEqual(
        fail
          ? "Unable to read the Openbot agent roster."
          : [{ id: "bot", name: "School", provider: "codex" }],
      );
    }),
);

it.effect("emits current readiness then start and stop changes without polling", () =>
  Effect.gen(function* () {
    let state: ManagedHost.HostStatus = { status: "stopped" };
    const first = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      expect(yield* service.readyHostId).toBe(null);
      const events = yield* service.readyChanges.pipe(
        Stream.tap(() => Deferred.succeed(first, undefined)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(first);
      yield* service.start;
      expect(yield* service.readyHostId).toBe("host");
      expect(
        yield* Effect.flip(
          service.apiReadToHost("different-host", {
            operation: "task.read",
            agentId: "bot1",
            taskId: "task1",
          }),
        ),
      ).toBeInstanceOf(Integration.IntegrationError);
      expect(
        yield* Effect.flip(
          service.apiWriteToHost("different-host", {
            operation: "task.stop",
            agentId: "bot1",
            taskId: "task1",
          }),
        ),
      ).toBeInstanceOf(Integration.IntegrationError);
      yield* service.stop;
      expect(yield* Fiber.join(events)).toEqual([null, "host", null]);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.sync(() => state),
        start: Effect.sync(() => {
          state = { status: "ready", ready };
          return ready;
        }),
        stop: Effect.sync(() => {
          state = { status: "stopped" };
        }),
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () => Effect.die("No request may reach a mismatched host"),
      }),
    );
  }),
);

it.effect(
  "recovers attention from a fresh runtime snapshot after disconnect and session expiry",
  () =>
    Effect.gen(function* () {
      const firstFrames = yield* Queue.make<EventStream.Frame, TeamClient.TeamClientError>();
      const nextFrames = yield* Queue.make<EventStream.Frame, TeamClient.TeamClientError>();
      const firstSubscribed = yield* Deferred.make<void>();
      const nextSubscribed = yield* Deferred.make<void>();
      const firstReady = yield* Deferred.make<void>();
      const disconnected = yield* Deferred.make<void>();
      const nextReady = yield* Deferred.make<void>();
      let logins = 0;
      let reads = 0;
      let closed = 0;
      let sawFirstReady = false;
      const context = {
        botId: "bot1",
        threadId: "thread1",
        usage: { usedTokens: 6000, windowTokens: 10000, autoCompactAt: null, nativeManaged: true },
        compaction: null,
      } as const;
      const request = { operation: "context.read", agentId: "bot1", threadId: "thread1" } as const;
      yield* Effect.gen(function* () {
        const service = yield* Integration.Integration;
        yield* service.subscribeChanges.pipe(
          Stream.runForEach(() =>
            service.attentionSnapshot.pipe(
              Effect.flatMap((snapshot) => {
                if (snapshot.requests[0]?.requestId === "first") {
                  sawFirstReady = true;
                  return Deferred.succeed(firstReady, undefined);
                }
                if (snapshot.requests[0]?.requestId === "next")
                  return Deferred.succeed(nextReady, undefined);
                if (sawFirstReady && snapshot.state === "connecting")
                  return Deferred.succeed(disconnected, undefined);
                return Effect.void;
              }),
            ),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(firstSubscribed);
        yield* Queue.offer(firstFrames, {
          type: "snapshot",
          complete: true,
          requests: [{ kind: "approval", requestId: "first", agentId: "bot1" }],
          contexts: [context],
        });
        yield* Deferred.await(firstReady);
        expect(yield* service.apiReadToHost("host", request)).toEqual(context);
        expect(yield* service.apiReadToHost("host", { ...request, threadId: "other" })).toBeNull();
        expect(yield* service.apiReadToHost("host", { ...request, agentId: "other" })).toBeNull();
        expect(yield* Effect.flip(service.apiReadToHost("other-host", request))).toBeInstanceOf(
          Integration.IntegrationError,
        );
        yield* Queue.fail(firstFrames, new TeamClient.TeamClientError({ reason: "transport" }));
        yield* Deferred.await(disconnected);
        expect((yield* service.attentionSnapshot).requests).toEqual([]);
        expect(yield* service.apiReadToHost("host", request)).toBeNull();
        yield* TestClock.adjust("1 second");
        yield* Deferred.await(nextSubscribed);
        yield* Queue.offer(nextFrames, {
          type: "snapshot",
          complete: false,
          requests: [{ kind: "prompt", requestId: "next", agentId: "bot1" }],
        });
        yield* Deferred.await(nextReady);
        expect(yield* service.attentionSnapshot).toMatchObject({
          hostId: "host",
          state: "ready",
          complete: false,
          requests: [{ requestId: "next" }],
        });
        expect(logins).toBe(2);
        expect(closed).toBe(1);
      }).pipe(
        Effect.provide(Integration.layerWithHost("owner-secret")),
        Effect.provideService(ManagedHost.ManagedHost, {
          changes: Stream.never,
          switchExecutable: () => Effect.die("unused executable switch"),
          getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
          start: Effect.succeed(ready),
          stop: Effect.void,
        }),
        Effect.provideService(TeamClient.TeamClient, {
          connect: () =>
            Effect.sync(() => {
              logins++;
              const first = logins === 1;
              return {
                files: unusedFiles,
                events: Stream.unwrap(
                  Deferred.succeed(first ? firstSubscribed : nextSubscribed, undefined).pipe(
                    Effect.as(Stream.fromQueue(first ? firstFrames : nextFrames)),
                  ),
                ),
                listAgents: Effect.suspend(() => {
                  reads++;
                  return first && reads > 1
                    ? Effect.fail(new TeamClient.TeamClientError({ reason: "http", status: 401 }))
                    : Effect.succeed([]);
                }),
                close: Effect.sync(() => {
                  closed++;
                }),
                apiRead: () => Effect.succeed(null),
                apiWrite: () => Effect.succeed(null),
                apiAdmin: () => Effect.succeed(null),
              };
            }),
        }),
      );
      expect(closed).toBe(2);
    }),
);

it.effect("drops the stopped host's pending attention and cancels its event subscription", () =>
  Effect.gen(function* () {
    const frames = yield* Queue.make<EventStream.Frame>();
    const subscribed = yield* Deferred.make<void>();
    const canceled = yield* Deferred.make<void>();
    const readyAttention = yield* Deferred.make<void>();
    let state: ManagedHost.HostStatus = { status: "ready", ready };
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      yield* service.subscribeChanges.pipe(
        Stream.runForEach(() =>
          service.attentionSnapshot.pipe(
            Effect.flatMap((snapshot) =>
              snapshot.state === "ready"
                ? Deferred.succeed(readyAttention, undefined)
                : Effect.void,
            ),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Deferred.await(subscribed);
      yield* Queue.offer(frames, {
        type: "snapshot",
        complete: true,
        requests: [{ kind: "takeover", requestId: "stale", agentId: "bot1" }],
      });
      yield* Deferred.await(readyAttention);
      yield* service.stop;
      yield* Deferred.await(canceled);
      yield* Queue.offer(frames, {
        type: "snapshot",
        complete: true,
        requests: [{ kind: "approval", requestId: "late", agentId: "bot1" }],
      });
      expect(yield* service.attentionSnapshot).toEqual({
        hostId: null,
        state: "disconnected",
        complete: false,
        requests: [],
      });
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.sync(() => state),
        start: Effect.succeed(ready),
        stop: Effect.sync(() => {
          state = { status: "stopped" };
        }),
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.succeed({
            files: unusedFiles,
            events: Stream.unwrap(
              Deferred.succeed(subscribed, undefined).pipe(Effect.as(Stream.fromQueue(frames))),
            ).pipe(Stream.ensuring(Deferred.succeed(canceled, undefined))),
            listAgents: Effect.succeed([]),
            close: Effect.void,
            apiRead: () => Effect.succeed(null),
            apiWrite: () => Effect.succeed(null),
            apiAdmin: () => Effect.succeed(null),
          }),
      }),
    );
  }),
);

it.effect("allows browser stop and live reads while navigation waits for the page", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    let stopCalls = 0;
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      const navigation = yield* service
        .apiAdminToHost("host", {
          operation: "browser.load",
          tabId: "owned",
          url: "http://owned.invalid/slow",
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(entered);
      const control = yield* Effect.gen(function* () {
        expect(yield* service.apiReadToHost("host", { operation: "compatibility.read" })).toEqual({
          ready: true,
        });
        yield* service.apiAdminToHost("host", { operation: "browser.stop", tabId: "owned" });
      }).pipe(Effect.timeout("1 second"), Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(control);
      yield* Fiber.join(navigation);
      expect(stopCalls).toBe(1);
    }).pipe(
      Effect.ensuring(Deferred.succeed(stopped, undefined)),
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.succeed({
            files: unusedFiles,
            events: Stream.never,
            listAgents: Effect.succeed([]),
            apiRead: () => Effect.succeed({ ready: true }),
            apiWrite: () => Effect.die("unused write"),
            apiAdmin: (input) =>
              input.operation === "browser.load"
                ? Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(stopped)),
                    Effect.as(null),
                  )
                : Effect.sync(() => {
                    expect(input.operation).toBe("browser.stop");
                    stopCalls++;
                  }).pipe(Effect.andThen(Deferred.succeed(stopped, undefined)), Effect.as(null)),
            close: Effect.void,
          }),
      }),
    );
  }),
);

it.effect.each(["replacement", "stop", "401"] as const)(
  "does not replay browser navigation after %s or accept a replaced session result",
  (transition) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let state: ManagedHost.HostStatus = { status: "ready", ready };
      let logins = 0;
      let navigations = 0;
      yield* Effect.gen(function* () {
        const service = yield* Integration.Integration;
        const navigation = yield* service
          .apiAdminToHost("host", {
            operation: "browser.load",
            tabId: "owned",
            url: "http://owned.invalid/slow",
          })
          .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(entered);
        if (transition === "replacement") {
          state = { status: "ready", ready: { ...ready, apiUrl: "http://127.0.0.1:8082" } };
          yield* service.listAgents;
        } else if (transition === "stop") yield* service.stop;
        yield* Deferred.succeed(release, undefined);
        const error = yield* Fiber.join(navigation);
        expect(error._tag).toBe("OpenbotIntegrationError");
        expect(error.message).toBe(
          transition === "401"
            ? "Unable to navigate the expected bot browser."
            : "The bot browser connection changed while navigating.",
        );
        expect(navigations).toBe(1);
        expect(logins).toBe(transition === "replacement" ? 2 : 1);
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.provide(Integration.layerWithHost("owner-secret")),
        Effect.provideService(ManagedHost.ManagedHost, {
          changes: Stream.never,
          switchExecutable: () => Effect.die("unused executable switch"),
          getStatus: Effect.sync(() => state),
          start: Effect.succeed(ready),
          stop: Effect.sync(() => {
            state = { status: "stopped" };
          }),
        }),
        Effect.provideService(TeamClient.TeamClient, {
          connect: () =>
            Effect.sync(() => {
              logins++;
              return {
                files: unusedFiles,
                events: Stream.never,
                listAgents: Effect.succeed([]),
                apiRead: () => Effect.succeed(null),
                apiWrite: () => Effect.die("unused write"),
                apiAdmin: () =>
                  Effect.gen(function* () {
                    navigations++;
                    yield* Deferred.succeed(entered, undefined);
                    yield* Deferred.await(release);
                    if (transition === "401")
                      return yield* new TeamClient.TeamClientError({ reason: "http", status: 401 });
                    return null;
                  }),
                close: Effect.void,
              };
            }),
        }),
      );
    }),
);

it.effect(
  "routes Sled Connect webhooks to the exact retained host without an OpenBot cloud account",
  () =>
    Effect.gen(function* () {
      const service = yield* Integration.Integration;
      const configuration = yield* service.apiAdminToHost("host", {
        operation: "events.configuration",
        owner: { kind: "agent", id: "agent" },
        id: "routine",
      });
      expect(configuration).toEqual({
        owner: { kind: "agent", id: "agent" },
        id: "routine",
        webhookUrl: "https://relay.example/owned",
        relayService: "sled-connect",
      });
      const workflow = yield* service.apiAdminToHost("host", {
        operation: "workflow.webhookConfiguration",
        workflowId: "workflow",
        nodeId: "trigger",
      });
      expect(workflow).toEqual({
        workflowId: "workflow",
        nodeId: "trigger",
        configured: true,
        webhookUrl: "https://relay.example/owned",
        relayService: "sled-connect",
      });
      expect(
        yield* service.receiveConnectWebhook({
          hookId: "owned",
          token: "valid",
          timestamp: "1",
          deliveryId: "delivery",
          signature: "signature",
          body: new Uint8Array([0, 255, 7]),
        }),
      ).toEqual({ status: 202 });
      expect(
        yield* service.receiveConnectWebhook({
          hookId: "owned",
          token: "wrong",
          timestamp: "1",
          deliveryId: "delivery",
          signature: "signature",
          body: new Uint8Array(),
        }),
      ).toEqual({ status: 404 });
      const foreign = yield* Effect.flip(
        service.receiveConnectWebhook({
          hookId: "foreign",
          token: "valid",
          timestamp: "1",
          deliveryId: "delivery",
          signature: "signature",
          body: new Uint8Array(),
        }),
      );
      expect(foreign).toBeInstanceOf(Integration.IntegrationError);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
        switchExecutable: () => Effect.die("unused switch"),
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.succeed({
            files: unusedFiles,
            events: Stream.never,
            listAgents: Effect.succeed([]),
            close: Effect.void,
            apiRead: () =>
              Effect.succeed({
                capabilities: ["sled-connect-webhooks-v1", "sled-connect-workflow-webhooks-v1"],
              }),
            apiWrite: () => Effect.die("No bot write is needed"),
            apiAdmin: (input) =>
              Effect.sync(() => {
                expect(input).toEqual({
                  operation: "workflow.webhookConfiguration",
                  workflowId: "workflow",
                  nodeId: "trigger",
                });
                return { routeId: "route" };
              }),
            connectWebhooks: {
              configuration: (input) =>
                Effect.sync(() => {
                  expect(input).toEqual({ owner: { kind: "agent", id: "agent" }, id: "routine" });
                  return { routeId: "route" };
                }),
              receive: (input) =>
                Effect.sync(() => {
                  expect(input.routeId).toBe("route");
                  expect([...input.body]).toEqual([0, 255, 7]);
                  return { status: 202 };
                }),
            },
          }),
      }),
      Effect.provideService(ConnectWebhookRouting.ConnectWebhookRouting, {
        address: (hostId, routeId) =>
          Effect.sync(() => {
            expect([hostId, routeId]).toEqual(["host", "route"]);
            return "https://relay.example/owned";
          }),
        target: (hookId, token) =>
          token !== "valid"
            ? null
            : { hostId: hookId === "foreign" ? "foreign-host" : "host", routeId: "route" },
      }),
    ),
);

it.effect("binds a live voice call to its paired session and expires an abandoned call", () =>
  Effect.gen(function* () {
    const frames = yield* Queue.make<EventStream.Frame, TeamClient.TeamClientError>();
    const subscribed = yield* Deferred.make<void>();
    const readyEvent = yield* Deferred.make<void>();
    const stopped: string[] = [];
    let starts = 0;
    const offer = { agentId: "bot", sdp: "v=0\r\nm=audio", voice: "sol" as const };
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      const command = service.liveVoiceCommand!;
      yield* service.subscribeChanges.pipe(
        Stream.runForEach(() =>
          service.attentionSnapshot.pipe(
            Effect.flatMap((snapshot) => {
              if (snapshot.state !== "ready") return Effect.void;
              return Deferred.succeed(readyEvent, undefined);
            }),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Deferred.await(subscribed);
      yield* Queue.offer(frames, { type: "snapshot", complete: true, requests: [] });
      yield* Deferred.await(readyEvent);

      const started = yield* command("phone-a", { action: "start", hostId: "host", offer });
      expect(started).toEqual({
        _tag: "started",
        answer: { sessionId: "live-call", sdp: "v=0\r\nm=audio" },
      });
      expect(
        yield* Effect.flip(command("phone-b", { action: "start", hostId: "host", offer })),
      ).toBeInstanceOf(Integration.IntegrationError);
      for (const action of ["read", "stop"] as const) {
        expect(
          yield* Effect.flip(
            command("phone-b", { action, hostId: "host", sessionId: "live-call" }),
          ),
        ).toBeInstanceOf(Integration.IntegrationError);
        expect(
          yield* Effect.flip(
            command("phone-a", { action, hostId: "different-host", sessionId: "live-call" }),
          ),
        ).toBeInstanceOf(Integration.IntegrationError);
      }
      expect(starts).toBe(1);
      expect(stopped).toEqual([]);

      yield* Queue.offer(frames, {
        type: "live-voice",
        event: {
          _tag: "transcript",
          sessionId: "foreign-call",
          role: "assistant",
          text: "Other",
          final: true,
        },
      });
      yield* Queue.offer(frames, {
        type: "live-voice",
        event: {
          _tag: "transcript",
          sessionId: "live-call",
          role: "user",
          text: "Synthetic words",
          final: true,
        },
      });
      yield* Queue.offer(frames, { type: "change", resource: "activity" });
      yield* TestClock.adjust("1 second");
      expect(
        yield* command("phone-a", { action: "read", hostId: "host", sessionId: "live-call" }),
      ).toEqual({
        _tag: "state",
        user: "Synthetic words",
        assistant: "",
        ended: false,
        failed: false,
      });
      yield* TestClock.adjust("20 seconds");
      expect(stopped).toEqual(["live-call"]);
      expect(
        yield* Effect.flip(
          command("phone-a", { action: "read", hostId: "host", sessionId: "live-call" }),
        ),
      ).toBeInstanceOf(Integration.IntegrationError);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        changes: Stream.never,
        switchExecutable: () => Effect.die("unused executable switch"),
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.succeed({
            files: unusedFiles,
            listAgents: Effect.succeed([]),
            close: Effect.void,
            apiRead: () => Effect.succeed({ capabilities: ["live-voice-v1"] }),
            apiWrite: () => Effect.succeed(null),
            apiAdmin: () => Effect.succeed(null),
            events: Stream.unwrap(
              Deferred.succeed(subscribed, undefined).pipe(Effect.as(Stream.fromQueue(frames))),
            ),
            liveVoice: {
              start: (incoming) =>
                Effect.sync(() => {
                  expect(incoming).toEqual(offer);
                  starts++;
                  return { sessionId: "live-call", sdp: "v=0\r\nm=audio" };
                }),
              stop: (sessionId) =>
                Effect.sync(() => {
                  stopped.push(sessionId);
                }),
            },
          }),
      }),
    );
  }),
);
