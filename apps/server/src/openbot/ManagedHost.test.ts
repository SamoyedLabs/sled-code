import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeURL from "node:url";

import * as ManagedHost from "./ManagedHost.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/managed-host.cjs", import.meta.url));
const config = Effect.fn("test.config")(function* (mode = "ready") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-host-" });
  return {
    executablePath: process.execPath,
    args: [fixture, mode],
    userDataDirectory: path.join(root, "profile"),
    agentRoot: path.join(root, "agents"),
    serverName: "Sled bots",
    ownerSecret: "fixture-secret-never-in-status",
    startupTimeoutMs: 5_000,
  } satisfies ManagedHost.ManagedHostConfig;
});

describe("ManagedHost", () => {
  it.effect("is disabled until explicitly configured", () =>
    Effect.gen(function* () {
      const host = yield* ManagedHost.ManagedHost;
      expect(yield* host.getStatus).toEqual({ status: "disabled" });
      const result = yield* host.start.pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      expect(yield* host.getStatus).toEqual({ status: "disabled" });
    }).pipe(Effect.provide(ManagedHost.layer(undefined).pipe(Layer.provide(NodeServices.layer)))),
  );

  it.live("starts one isolated child for concurrent callers and can stop and restart it", () =>
    Effect.gen(function* () {
      const options = yield* config();
      yield* Effect.gen(function* () {
        const host = yield* ManagedHost.ManagedHost;
        expect(yield* host.getStatus).toEqual({ status: "stopped" });
        const [first, second] = yield* Effect.all([host.start, host.start], { concurrency: 2 });
        expect(first).toEqual(second);
        expect(first.apiUrl).toBe("http://127.0.0.1:9090");
        expect(first.serverId).toMatch(/^fixture-server-\d+$/);
        expect(yield* host.getStatus).toEqual({ status: "ready", ready: first });
        expect(JSON.stringify(yield* host.getStatus)).not.toContain(options.ownerSecret);
        yield* host.stop;
        expect(yield* host.getStatus).toEqual({ status: "stopped" });
        expect((yield* host.start).serverId).not.toBe(first.serverId);
        yield* host.stop;
      }).pipe(
        Effect.provide(ManagedHost.layer(options)),
        Effect.provideService(HostProcess.Environment, {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          OPENBOT_DEV_UNSAFE: "1",
        }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live.each(["remote", "exit"])("rejects %s readiness without leaking the secret", (mode) =>
    Effect.gen(function* () {
      const options = yield* config(mode);
      yield* Effect.gen(function* () {
        const host = yield* ManagedHost.ManagedHost;
        expect(Result.isFailure(yield* host.start.pipe(Effect.result))).toBe(true);
        expect((yield* host.getStatus).status).toBe("failed");
        expect(JSON.stringify(yield* host.getStatus)).not.toContain(options.ownerSecret);
        yield* host.stop;
        expect(yield* host.getStatus).toEqual({ status: "stopped" });
      }).pipe(Effect.provide(ManagedHost.layer(options)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("bounds startup and terminates a child that never becomes ready", () =>
    Effect.gen(function* () {
      const options = yield* config("wait");
      yield* Effect.gen(function* () {
        const host = yield* ManagedHost.ManagedHost;
        const result = yield* host.start.pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        expect(yield* host.getStatus).toEqual({ status: "failed", reason: "timeout" });
      }).pipe(Effect.provide(ManagedHost.layer({ ...options, startupTimeoutMs: 1 })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("terminates the owned child when the service scope closes", () =>
    Effect.gen(function* () {
      const options = yield* config();
      const pid = yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* ManagedHost.ManagedHost;
          const ready = yield* host.start;
          const childPid = Number(ready.serverId.slice("fixture-server-".length));
          expect(Number.isInteger(childPid) && childPid > 0).toBe(true);
          expect(process.kill(childPid, 0)).toBe(true);
          return childPid;
        }).pipe(Effect.provide(ManagedHost.layer(options))),
      );
      expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects relative state paths before launching a process", () =>
    Effect.gen(function* () {
      const options = yield* config();
      yield* Effect.gen(function* () {
        const host = yield* ManagedHost.ManagedHost;
        expect(Result.isFailure(yield* host.start.pipe(Effect.result))).toBe(true);
        expect(yield* host.getStatus).toEqual({ status: "failed", reason: "configuration" });
      }).pipe(Effect.provide(ManagedHost.layer({ ...options, userDataDirectory: "relative" })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
