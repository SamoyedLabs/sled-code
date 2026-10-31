import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthDesktopOperateScope,
  AuthStandardClientScopes,
  EnvironmentId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Authority from "./Authority.ts";

const testLayer = Authority.layer.pipe(
  Layer.provideMerge(SessionStore.layer),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("remote-desktop-test")),
    }),
  ),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-remote-desktop-auth-" })),
  Layer.provide(NodeServices.layer),
);

describe("RemoteDesktop persisted authorization", () => {
  it.effect("requires an explicit desktop grant in the persisted T3 credential", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const authority = yield* Authority.Authority;
      const broad = yield* sessions.issue({ subject: "owner", scopes: AuthStandardClientScopes });
      const owner = {
        sessionId: broad.sessionId,
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
      };
      expect(yield* authority.authorize(owner).pipe(Effect.flip)).toMatchObject({
        reason: "forbidden",
      });
      const granted = yield* sessions.issue({
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
      });
      expect(yield* authority.authorize({ ...owner, sessionId: granted.sessionId })).toBe(
        granted.expiresAt.epochMilliseconds,
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
  it.effect("does not expand a legacy or read-only caller into desktop control", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const authority = yield* Authority.Authority;
      const granted = yield* sessions.issue({
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
      });
      expect(
        yield* authority
          .authorize({
            sessionId: granted.sessionId,
            subject: "owner",
            scopes: AuthStandardClientScopes,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "forbidden" });
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
  it.effect("rejects a revoked credential and a different credential subject", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const authority = yield* Authority.Authority;
      const granted = yield* sessions.issue({
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
      });
      const owner = {
        sessionId: granted.sessionId,
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
      };
      expect(
        yield* authority.authorize({ ...owner, subject: "another-owner" }).pipe(Effect.flip),
      ).toMatchObject({ reason: "forbidden" });
      yield* sessions.revoke(granted.sessionId);
      expect(yield* authority.authorize(owner).pipe(Effect.flip)).toMatchObject({
        reason: "revoked",
      });
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
  it.effect("rejects expired credentials using the server clock", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const authority = yield* Authority.Authority;
      const granted = yield* sessions.issue({
        subject: "owner",
        scopes: [AuthDesktopOperateScope],
        ttl: Duration.seconds(1),
      });
      yield* TestClock.adjust("1 second");
      expect(
        yield* authority
          .authorize({
            sessionId: granted.sessionId,
            subject: "owner",
            scopes: [AuthDesktopOperateScope],
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "expired" });
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});
