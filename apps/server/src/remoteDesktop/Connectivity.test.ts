import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Connectivity from "./Connectivity.ts";

const cloudflare = {
  provider: "cloudflare",
  keyId: "test-key",
  apiToken: "private-test-provider-token",
};
const issued = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "temporary-test-user",
      credential: "temporary-test-password",
    },
  ],
};
const setup = Effect.fn("ConnectivityTest.setup")(function* (
  initial?: unknown,
  body: unknown = issued,
  status = 201,
) {
  let stored = initial === undefined ? undefined : JSON.stringify(initial);
  const requests: { url: string; authorization: string | undefined; body: string }[] = [];
  const secrets = ServerSecretStore.ServerSecretStore.of({
    get: () =>
      Effect.sync(() =>
        stored === undefined ? Option.none() : Option.some(new TextEncoder().encode(stored)),
      ),
    set: (_name, bytes) =>
      Effect.sync(() => {
        stored = new TextDecoder().decode(bytes);
      }),
    create: () => Effect.void,
    getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
    remove: () =>
      Effect.sync(() => {
        stored = undefined;
      }),
  });
  const http = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
    });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
      ),
    );
  });
  const context = yield* Layer.build(
    Connectivity.layer.pipe(
      Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, secrets)),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      Layer.provide(NodeCrypto.layer),
    ),
  );
  return {
    service: Context.get(context, Connectivity.Connectivity),
    requests,
    replace: (value: unknown) =>
      secrets.set("remote-desktop-turn", new TextEncoder().encode(JSON.stringify(value))),
    remove: secrets.remove("remote-desktop-turn"),
  };
});

describe("remote desktop connectivity issuance", () => {
  it.effect(
    "keeps ten-minute credentials cached until their refresh window, then rotates them",
    () =>
      Effect.gen(function* () {
        const f = yield* setup({ ...cloudflare, ttlSeconds: 600 });
        const first = yield* f.service.get("owner");
        expect(first.expiresAt).toBe(600_000);
        expect(f.requests[0]?.body).toBe('{"ttl":600}');
        expect(yield* f.service.get("owner")).toEqual(first);
        expect(f.requests).toHaveLength(1);
        yield* TestClock.adjust("5 minutes");
        expect((yield* f.service.get("owner")).expiresAt).toBe(900_000);
        expect(f.requests).toHaveLength(2);
      }).pipe(Effect.scoped),
  );
  it.effect("uses free STUN without inventing relay credentials when unconfigured", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      expect(yield* f.service.get("owner")).toMatchObject({
        relayAvailable: false,
        relayOnly: false,
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      });
      expect(f.requests).toHaveLength(0);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "issues owner-specific short-lived credentials, reuses them, and honors config removal and rotation",
    () =>
      Effect.gen(function* () {
        const f = yield* setup(cloudflare);
        const first = yield* f.service.get("owner");
        expect(first).toMatchObject({ relayAvailable: true, expiresAt: 3_600_000 });
        expect(first.iceServers.flatMap((server) => server.urls)).not.toContain(
          "stun:stun.cloudflare.com:53",
        );
        expect(f.requests[0]).toEqual({
          url: "https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers",
          authorization: `Bearer ${cloudflare.apiToken}`,
          body: '{"ttl":3600}',
        });
        expect(yield* f.service.get("owner")).toEqual(first);
        expect(f.requests).toHaveLength(1);
        yield* f.service.get("other-owner");
        expect(f.requests).toHaveLength(2);
        yield* f.replace({ ...cloudflare, keyId: "rotated-key" });
        yield* f.service.get("owner");
        expect(f.requests.at(-1)?.url).toContain("/rotated-key/");
        yield* f.remove;
        expect((yield* f.service.get("owner")).relayAvailable).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.effect("refreshes near expiry and bounds the number of credential owners", () =>
    Effect.gen(function* () {
      const f = yield* setup(cloudflare);
      for (let index = 0; index < 32; index++) yield* f.service.get(`owner-${index}`);
      expect(yield* f.service.get("overflow").pipe(Effect.flip)).toBeInstanceOf(
        Connectivity.ConnectivityError,
      );
      expect(f.requests).toHaveLength(32);
      yield* TestClock.adjust("51 minutes");
      expect((yield* f.service.get("overflow")).expiresAt).toBe(6_660_000);
      expect(f.requests).toHaveLength(33);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps provider failures and invalid secret material out of printable errors", () =>
    Effect.gen(function* () {
      for (const [body, status] of [
        [issued, 401],
        ["invalid-json", 201],
        ["x".repeat(16_385), 201],
        [
          { iceServers: [{ urls: ["turn:evil.example:99999"], username: "u", credential: "p" }] },
          201,
        ],
        [{ iceServers: [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"] }] }, 201],
      ] as const) {
        const f = yield* setup(cloudflare, body, status);
        const error = yield* f.service.get("owner").pipe(Effect.flip);
        expect(error).toBeInstanceOf(Connectivity.ConnectivityError);
        expect(String(error)).not.toContain(cloudflare.apiToken);
        expect(JSON.stringify(error)).not.toContain(cloudflare.apiToken);
      }
      const invalid = yield* setup({ ...cloudflare, keyId: "../../unexpected" });
      expect(yield* invalid.service.get("owner").pipe(Effect.flip)).toBeInstanceOf(
        Connectivity.ConnectivityError,
      );
      expect(invalid.requests).toHaveLength(0);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "mints distinct expiring coturn credentials without sending its shared secret to a client",
    () =>
      Effect.gen(function* () {
        const sharedSecret = "test-only-shared-secret";
        const f = yield* setup({
          provider: "coturn",
          sharedSecret,
          urls: ["turn:127.0.0.1:3478?transport=udp"],
          relayOnly: true,
        });
        const first = yield* f.service.get("owner");
        const second = yield* f.service.get("other-owner");
        expect(first).toMatchObject({ relayAvailable: true, relayOnly: true });
        expect(first.iceServers[0]?.username).toMatch(/^3600:[0-9a-f-]{36}$/);
        expect(first.iceServers[0]?.username).not.toBe(second.iceServers[0]?.username);
        expect(JSON.stringify(first)).not.toContain(sharedSecret);
        expect(f.requests).toHaveLength(0);
      }).pipe(Effect.scoped),
  );
});
