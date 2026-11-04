import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Integration from "./Integration.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";

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
    yield* Effect.gen(function* () {
      const service = yield* Integration.Integration;
      for (let index = 0; index < 8; index++) yield* service.listAgents;
      expect(logins).toBe(1);
      expect(logouts).toBe(0);
      yield* service.stop;
      expect(logouts).toBe(1);
    }).pipe(
      Effect.provide(Integration.layerWithHost("owner-secret")),
      Effect.provideService(ManagedHost.ManagedHost, {
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.sync(() => {
            logins++;
            return {
              listAgents: Effect.succeed([]),
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
        getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
        start: Effect.succeed(ready),
        stop: Effect.void,
      }),
      Effect.provideService(TeamClient.TeamClient, {
        connect: () =>
          Effect.sync(() => {
            logins++;
            return {
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
        expect(yield* service.status).toEqual({ state: "ready" });
        return yield* service.listAgents;
      }).pipe(
        Effect.provide(Integration.layerWithHost("owner-secret")),
        Effect.provideService(ManagedHost.ManagedHost, {
          getStatus: Effect.succeed<ManagedHost.HostStatus>({ status: "ready", ready }),
          start: Effect.succeed(ready),
          stop: Effect.void,
        }),
        Effect.provideService(TeamClient.TeamClient, {
          connect: (input) => {
            expect(input).toEqual({ apiUrl: ready.apiUrl, ownerSecret: "owner-secret" });
            return Effect.succeed({
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
