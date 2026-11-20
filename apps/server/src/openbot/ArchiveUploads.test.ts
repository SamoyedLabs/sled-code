import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, type ServerAuthSessionMethod } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Config from "../config.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Sessions from "../persistence/AuthSessions.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Archives from "./ArchiveUploads.ts";

const dependencies = Layer.mergeAll(Sessions.layer, Secrets.layer).pipe(
  Layer.provideMerge(Config.layerTest(process.cwd(), { prefix: "transfer-owner-test-" })),
  Layer.provide(Sqlite.layerMemory),
);
const application = Archives.layer.pipe(
  Layer.provideMerge(dependencies),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);
it.effect(
  "only a live local desktop replacement can release its predecessor's transfer allocation",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions.AuthSessionRepository;
      const archives = yield* Archives.ArchiveUploads;
      const create = (
        id: string,
        subject: string,
        method: ServerAuthSessionMethod = "bearer-access-token",
      ) =>
        sessions.create({
          sessionId: AuthSessionId.make(id),
          subject,
          method,
          scopes: [],
          client: {
            label: null,
            ipAddress: null,
            userAgent: null,
            deviceType: "desktop",
            os: null,
            browser: null,
          },
          issuedAt: DateTime.makeUnsafe("2026-11-12T00:00:00Z"),
          expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00Z"),
        });
      yield* create("original", "desktop-bootstrap");
      yield* create("successor", "desktop-bootstrap");
      yield* create("paired", "pairing-bootstrap");
      yield* create("browser", "desktop-bootstrap", "browser-session-cookie");
      const allocation = yield* archives.issue("original", {
        hostId: "host",
        principalId: "original",
        name: "owned.zip",
        size: 3,
      });
      yield* archives.store(
        allocation.relativeUrl.split("/").at(-1)!,
        Stream.fromIterable([new TextEncoder().encode("zip")]),
      );
      yield* sessions.revoke({
        sessionId: AuthSessionId.make("original"),
        revokedAt: DateTime.makeUnsafe("2026-11-12T01:00:00Z"),
      });
      expect(yield* archives.canRecoverTransfer("successor", "original")).toBe(true);
      expect(yield* archives.canRecoverTransfer("paired", "original")).toBe(false);
      expect(yield* archives.canRecoverTransfer("browser", "original")).toBe(false);
      yield* Effect.flip(
        archives.releaseTransfer("paired", "original", "host", allocation.uploadId),
      );
      yield* Effect.flip(
        archives.releaseTransfer("successor", "original", "other-host", allocation.uploadId),
      );
      yield* archives.releaseTransfer("successor", "original", "host", allocation.uploadId);
      yield* archives.releaseTransfer("successor", "original", "host", allocation.uploadId);
      yield* sessions.revoke({
        sessionId: AuthSessionId.make("successor"),
        revokedAt: DateTime.makeUnsafe("2026-11-12T02:00:00Z"),
      });
      yield* Effect.flip(archives.canRecoverTransfer("successor", "original"));
      yield* Effect.flip(
        archives.releaseTransfer("successor", "original", "host", allocation.uploadId),
      );
    }).pipe(Effect.provide(application)),
);
