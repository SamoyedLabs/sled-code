import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { OpenbotInstalledRuntime } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Integration from "./Integration.ts";
import * as Recovery from "./HostRecovery.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as RuntimeInstallation from "./RuntimeInstallation.ts";
import * as TeamClient from "./TeamClient.ts";

it.effect(
  "Stop cancels an activation that holds the integration gate and leaves the prior runtime stopped",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const ready: ManagedHost.HostReady = {
        serverId: "host",
        serverName: "Bots",
        apiUrl: "http://127.0.0.1:8080",
        fingerprint: "fp",
        publicKey: "key",
        ownerMemberId: "owner",
      };
      let state: ManagedHost.HostStatus = { status: "stopped" };
      let restoredWithoutStart = false;
      const prior: OpenbotInstalledRuntime = {
        version: "v0.60.0",
        platform: "darwin-arm64",
        sha256: "a".repeat(64),
        releaseCommit: "a".repeat(40),
        executablePath: "/fixture/old",
        installedAt: "2026-01-01T00:00:00Z",
        compatibility: "pinned-baseline",
      };
      const next: OpenbotInstalledRuntime = { ...prior, executablePath: "/fixture/new" };
      const managed = Layer.succeed(ManagedHost.ManagedHost, {
        getStatus: Effect.sync(() => state),
        changes: Stream.never,
        start: Effect.sync(() => {
          state = { status: "ready", ready };
          return ready;
        }),
        stop: Effect.sync(() => {
          state = { status: "stopped" };
        }),
        switchExecutable: (path, options) =>
          path === next.executablePath
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.sync(() => {
                restoredWithoutStart = options?.start === false;
                state = { status: "stopped" };
                return null;
              }),
      });
      const recovery = Recovery.layer.pipe(Layer.provide(managed));
      yield* Effect.gen(function* () {
        const service = yield* Integration.Integration;
        yield* service.start;
        const activation = yield* service
          .activateRuntime({ version: next.version, platform: next.platform })
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        yield* service.stop;
        expect(Exit.isFailure(yield* Fiber.await(activation))).toBe(true);
        expect(restoredWithoutStart).toBe(true);
        expect(yield* service.status).toMatchObject({ state: "stopped", desiredRunning: false });
      }).pipe(
        Effect.provide(
          Integration.layerWithHost("owner-secret").pipe(
            Layer.provide(recovery),
            Layer.provide(managed),
            Layer.provide(
              Layer.mock(RuntimeInstallation.RuntimeInstallation)({
                getStatus: Effect.succeed({
                  installed: [prior, next],
                  active: prior,
                  previous: null,
                }),
                resolve: () => Effect.succeed(next),
                select: () => Effect.die("Cancelled activation must not commit"),
              }),
            ),
            Layer.provide(
              Layer.mock(TeamClient.TeamClient)({
                connect: () => Effect.die("Blocked activation must not open a session"),
              }),
            ),
          ),
        ),
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Architecture, "arm64"),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          Sqlite.layerMemory,
          Config.layerTest(process.cwd(), { prefix: "bot-integration-recovery-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
);
