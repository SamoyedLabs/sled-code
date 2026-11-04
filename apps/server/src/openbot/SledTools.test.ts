import { expect, it } from "@effect/vitest";
import { AuthSessionId, authScopeResponse, type AuthClientSession } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as NetAddress from "effect/net/NetAddress";
import * as HttpServer from "effect/http/HttpServer";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Integration from "./Integration.ts";
import * as SledTools from "./SledTools.ts";

function fixture() {
  const stored = new Map<string, Uint8Array>();
  const sessions = new Map<AuthSessionId, AuthClientSession>();
  const calls: Array<{
    hostId: string;
    operation: string;
    url?: string;
    authorization?: string | undefined;
  }> = [];
  let host: string | null = "fixture-host";
  let rejected = false;
  let revocationFailure = false;
  let issued = 0;
  let config: { id: string; name: string } | null = null;
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const expiresAt = DateTime.makeUnsafe("2030-01-01T00:00:00.000Z");
  const layer = SledTools.layer.pipe(
    Layer.provide(SecureRandom.layerWebCrypto),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(HttpServer.HttpServer)({
          address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 4040),
        }),
        Layer.mock(EnvironmentAuth.EnvironmentAuth)({
          issueMcpClientSession: (input) =>
            Effect.sync(() => {
              const sessionId = AuthSessionId.make(`fixture-session-${++issued}`);
              sessions.set(sessionId, {
                sessionId,
                subject: "mcp-client",
                ...authScopeResponse([]),
                method: "bearer-access-token",
                client: input.client,
                issuedAt: now,
                expiresAt,
                lastConnectedAt: null,
                connected: false,
                current: false,
              });
              return { sessionId, token: `fixture-private-token-${issued}`, expiresAt };
            }),
          revokeSession: (sessionId) =>
            Effect.suspend(() =>
              revocationFailure
                ? Effect.fail(
                    new EnvironmentAuth.ServerAuthSessionRevocationError({
                      cause: new Error("storage unavailable"),
                    }),
                  )
                : Effect.sync(() => sessions.delete(sessionId)),
            ),
          listSessions: () => Effect.sync(() => [...sessions.values()]),
        }),
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: (key) => Effect.sync(() => Option.fromNullishOr(stored.get(key))),
          set: (key, value) =>
            Effect.sync(() => {
              stored.set(key, value);
            }),
        }),
        Layer.mock(Integration.Integration)({
          readyHostId: Effect.sync(() => host),
          apiAdminToHost: (expected, input) =>
            Effect.gen(function* () {
              if (host !== expected)
                return yield* new Integration.IntegrationError({
                  message: "Fixture unavailable",
                  cause: new Error("fixture"),
                });
              if (input.operation === "mcp.list") return config ? [config] : [];
              if (input.operation === "mcp.save") {
                if (!input.config.id && config?.name === input.config.name)
                  return yield* new Integration.IntegrationError({
                    message: "Duplicate MCP name",
                    cause: new Error("release requires the generated ID when updating"),
                  });
                if (input.config.id && input.config.id !== config?.id)
                  return yield* new Integration.IntegrationError({
                    message: "Unknown upstream MCP ID",
                    cause: new Error("release rejects supplied creation IDs"),
                  });
                config = { id: config?.id ?? "upstream-generated-id", name: input.config.name };
                if (rejected)
                  return yield* new Integration.IntegrationError({
                    message: "Fixture response lost after create",
                    cause: new Error("transport"),
                  });
              }
              if (input.operation === "mcp.delete") {
                expect(input.mcpServerId).toBe(config?.id);
                config = null;
              }
              calls.push({
                hostId: expected,
                operation: input.operation,
                ...(input.operation === "mcp.save"
                  ? { url: input.config.url, authorization: input.config.headers[0]?.value }
                  : {}),
              });
              return config ? [config] : [];
            }),
        }),
      ),
    ),
  );
  return {
    layer,
    sessions,
    calls,
    stored,
    failRevocation: (value: boolean) => {
      revocationFailure = value;
    },
    offline: () => {
      host = null;
    },
    online: () => {
      host = "fixture-host";
    },
    reject: () => {
      rejected = true;
    },
  };
}

it.effect("uses the actual listener, rotates credentials, and persists no bearer token", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const service = yield* SledTools.SledTools;
    const first = yield* service.connect({ access: "read-only" });
    expect(first).toMatchObject({
      state: "connected",
      access: "read-only",
      hostId: "fixture-host",
    });
    expect(f.calls[0]).toMatchObject({
      url: "http://127.0.0.1:4040/mcp",
      authorization: "Bearer fixture-private-token-1",
    });
    yield* service.connect({ access: "approval-required" });
    expect([...f.sessions.keys()]).toEqual([AuthSessionId.make("fixture-session-2")]);
    expect(JSON.stringify(first)).not.toContain("private-token");
    expect(
      [...f.stored.values()].map((value) => new TextDecoder().decode(value)).join(""),
    ).not.toContain("private-token");
    f.sessions.clear();
    expect(yield* service.status).toMatchObject({ state: "expired" });
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "revokes the credential and removes the generated upstream configuration after a lost save response",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const service = yield* SledTools.SledTools;
      f.reject();
      expect((yield* Effect.flip(service.connect({ access: "full-access" }))).operation).toBe(
        "connect",
      );
      expect(f.sessions.size).toBe(0);
      expect(yield* service.status).toEqual({ state: "disconnected" });
      expect(f.calls.at(-1)?.operation).toBe("mcp.delete");
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("revokes while offline and resumes upstream cleanup after reconstruction", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const service = yield* SledTools.SledTools;
      yield* service.connect({ access: "read-only" });
      f.offline();
      f.failRevocation(true);
      expect(yield* service.disconnect).toEqual({ state: "revocation-pending" });
      expect(f.sessions.size).toBe(1);
      f.failRevocation(false);
      yield* service.reconcile;
      expect(yield* service.status).toEqual({ state: "cleanup-pending" });
      expect(f.sessions.size).toBe(0);
    }).pipe(Effect.provide(f.layer));
    f.online();
    yield* Effect.gen(function* () {
      const service = yield* SledTools.SledTools;
      yield* service.reconcile;
      expect(yield* service.status).toEqual({ state: "disconnected" });
    }).pipe(Effect.provide(f.layer));
    expect(f.calls.at(-1)).toMatchObject({ operation: "mcp.delete", hostId: "fixture-host" });
  });
});
