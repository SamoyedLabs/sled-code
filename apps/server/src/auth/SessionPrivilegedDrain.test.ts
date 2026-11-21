import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SessionStore from "./SessionStore.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const persistence = SqlitePersistence.layerMemory;
const sessionsLayer = SessionStore.layer.pipe(
  Layer.provide(persistence),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("private-drain-proof")),
    }),
  ),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "private-drain-proof-" })),
);
it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "privileged lifecycle drain",
  (it) => {
    it.effect.each(["revoke", "bulk", "replace", "expiry"] as const)(
      "%s remains pending while an acquired effect can still commit",
      (operation) =>
        Effect.gen(function* () {
          const sessions = yield* SessionStore.SessionStore;
          const sql = yield* SqlClient.SqlClient;
          const owner = yield* sessions.issue({ subject: "owner" });
          const current = yield* sessions.issue({ subject: "original", ttl: Duration.minutes(1) });
          yield* sql`INSERT INTO privileged_commit_children VALUES ('private-engine','private-env','private-host','alive')`;
          yield* sql`INSERT INTO privileged_commit_grants VALUES ('permit',${current.sessionId},'private-engine','original-nonce','private-identity','outstanding')`;
          const completed = yield* Deferred.make<void>();
          const work =
            operation === "revoke"
              ? sessions.revoke(current.sessionId)
              : operation === "bulk"
                ? sessions.revokeAllExcept(owner.sessionId)
                : operation === "replace"
                  ? sessions.issue({ subject: "replacement", replaceSessionId: current.sessionId })
                  : sessions.awaitInvalidation(current.sessionId);
          const fiber = yield* work.pipe(
            Effect.asVoid,
            Effect.andThen(Deferred.succeed(completed, undefined)),
            Effect.forkScoped({ startImmediately: true }),
          );
          yield* TestClock.adjust(
            operation === "expiry" ? Duration.minutes(1) : Duration.millis(50),
          );
          expect(yield* Deferred.isDone(completed)).toBe(false);
          expect(
            (yield* sql`SELECT principal FROM privileged_commit_closed WHERE principal=${current.sessionId}`)
              .length,
          ).toBe(1);
          expect(
            (yield* sql`SELECT revoked_at FROM auth_sessions WHERE session_id=${current.sessionId}`)[0]
              ?.revoked_at,
          ).toBe(null);
          // Models the durable finish ACK. Subprocess tests separately prove exact exit reconciliation.
          yield* sql`UPDATE privileged_commit_grants SET state='finished' WHERE permit='permit'`;
          yield* TestClock.adjust(Duration.millis(50));
          yield* Fiber.join(fiber);
          expect(yield* Deferred.isDone(completed)).toBe(true);
        }).pipe(
          Effect.scoped,
          Effect.provide(Layer.mergeAll(sessionsLayer, persistence, TestClock.layer())),
        ),
    );
  },
);
