// @effect-diagnostics nodeBuiltinImport:off - this Node adapter owns the Electron child and its readiness/close events.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HostProcess from "@t3tools/shared/HostProcess";

export interface ManagedHostConfig {
  readonly executablePath?: string;
  readonly allowExecutableSwitch?: boolean;
  readonly args?: ReadonlyArray<string>;
  readonly userDataDirectory: string;
  readonly agentRoot: string;
  readonly serverName: string;
  readonly ownerSecret: string;
  readonly runtimeRoot?: string;
  readonly startupTimeoutMs?: number;
}

const HostReady = Schema.Struct({
  serverId: Schema.String,
  serverName: Schema.String,
  apiUrl: Schema.String,
  fingerprint: Schema.String,
  publicKey: Schema.String,
  ownerMemberId: Schema.String,
});
export type HostReady = typeof HostReady.Type;
const decodeReady = Schema.decodeUnknownSync(HostReady);
const FailureReason = Schema.Literals([
  "disabled",
  "configuration",
  "filesystem",
  "spawn",
  "readiness",
  "timeout",
  "exited",
]);
type FailureReason = typeof FailureReason.Type;

export class ManagedHostError extends Schema.TaggedError<ManagedHostError>()("ManagedHostError", {
  reason: FailureReason,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Openbot host failed (${this.reason}).`;
  }
}

export type HostStatus =
  | { readonly status: "disabled" | "stopped" | "starting" }
  | { readonly status: "ready"; readonly ready: HostReady }
  | { readonly status: "failed"; readonly reason: FailureReason };

export class ManagedHost extends Context.Service<
  ManagedHost,
  {
    readonly getStatus: Effect.Effect<HostStatus>;
    readonly start: Effect.Effect<HostReady, ManagedHostError>;
    readonly stop: Effect.Effect<void>;
    readonly switchExecutable: (
      executablePath: string | null,
    ) => Effect.Effect<HostReady | null, ManagedHostError>;
  }
>()("t3/openbot/ManagedHost") {}

// Launch/readiness contract: Openbot v0.60.0, 0c7753fa622c38419939cd230657f40e5883d098.
const READY_PREFIX = "OPENBOT_LOCAL_SERVER_READY ";
const MAX_LINE_BYTES = 16_384;

interface RunningChild {
  readonly child: NodeChildProcess.ChildProcess;
  closed: boolean;
  stopping: boolean;
}

const waitForClose = Effect.fn("ManagedHost.waitForClose")(function* (running: RunningChild) {
  yield* Effect.callback<void>((resume) => {
    if (running.closed) {
      resume(Effect.void);
      return;
    }
    const onClose = () => resume(Effect.void);
    running.child.once("close", onClose);
    return Effect.sync(() => running.child.off("close", onClose));
  });
});

const validConfiguration = (config: ManagedHostConfig): boolean => {
  const directories = [config.userDataDirectory, config.agentRoot];
  if (config.runtimeRoot !== undefined) directories.push(config.runtimeRoot);
  return (
    (config.executablePath === undefined || NodePath.isAbsolute(config.executablePath)) &&
    directories.every(
      (directory) =>
        NodePath.isAbsolute(directory) &&
        NodePath.resolve(directory) !== NodePath.parse(directory).root,
    ) &&
    NodePath.resolve(config.userDataDirectory) !== NodePath.resolve(config.agentRoot) &&
    config.serverName.trim().length > 0 &&
    config.serverName.length <= 256 &&
    config.ownerSecret.length > 0 &&
    config.ownerSecret.length <= 4_096 &&
    !(config.args ?? []).some((argument) => argument.startsWith("--user-data-dir")) &&
    (config.startupTimeoutMs === undefined ||
      (Number.isInteger(config.startupTimeoutMs) &&
        config.startupTimeoutMs > 0 &&
        config.startupTimeoutMs <= 90_000))
  );
};

const parseReady = (line: string): HostReady => {
  const ready = decodeReady(JSON.parse(line.slice(READY_PREFIX.length)));
  if (Object.values(ready).some((value) => !value || value.length > 4_096))
    throw new Error("Invalid readiness");
  const endpoint = new URL(ready.apiUrl);
  // Released hosts advertise localhost; pin it numerically before any authenticated request.
  if (endpoint.hostname === "localhost") endpoint.hostname = "127.0.0.1";
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error("Invalid readiness endpoint");
  return { ...ready, apiUrl: endpoint.origin };
};

const make = Effect.fn("ManagedHost.make")(function* (config: ManagedHostConfig | undefined) {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* HostProcess.Environment;
  const gate = yield* Semaphore.make(1);
  let state: HostStatus = { status: config?.executablePath ? "stopped" : "disabled" };
  let executablePath = config?.executablePath;
  let running: RunningChild | undefined;
  let disposed = false;

  const stopOwned = Effect.fn("ManagedHost.stopOwned")(function* () {
    const active = running;
    if (!active) return;
    active.stopping = true;
    active.child.stdin?.end();
    const graceful = yield* waitForClose(active).pipe(Effect.timeoutOption(6_000));
    if (Option.isNone(graceful)) {
      yield* Effect.sync(() => {
        active.child.kill("SIGTERM");
      });
      const terminated = yield* waitForClose(active).pipe(Effect.timeoutOption(1_000));
      if (Option.isNone(terminated)) {
        yield* Effect.sync(() => {
          active.child.kill("SIGKILL");
        });
        yield* waitForClose(active).pipe(Effect.timeoutOption(1_000));
      }
    }
    if (running === active) running = undefined;
  });

  yield* Effect.addFinalizer(() =>
    gate.withPermit(
      Effect.gen(function* () {
        disposed = true;
        yield* stopOwned();
        state = { status: executablePath ? "stopped" : "disabled" };
      }),
    ),
  );

  const start = Effect.fn("ManagedHost.start")(function* () {
    const command = executablePath;
    if (!config || !command) return yield* new ManagedHostError({ reason: "disabled" });
    if (disposed) return yield* new ManagedHostError({ reason: "exited" });
    if (state.status === "ready") return state.ready;
    if (!validConfiguration({ ...config, executablePath: command }))
      return yield* new ManagedHostError({ reason: "configuration" });
    state = { status: "starting" };
    yield* stopOwned();
    yield* Effect.forEach([config.userDataDirectory, config.agentRoot], (path) =>
      fileSystem.makeDirectory(path, { recursive: true, mode: 0o700 }),
    ).pipe(Effect.mapError((cause) => new ManagedHostError({ reason: "filesystem", cause })));
    const childEnvironment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(environment)) {
      if (
        name === "ELECTRON_RUN_AS_NODE" ||
        name.startsWith("OPENBOT_DEV_") ||
        name.startsWith("OPENBOT_LOCAL_SERVER_")
      )
        continue;
      childEnvironment[name] = value;
    }
    Object.assign(childEnvironment, {
      OPENBOT_LOCAL_SERVER_CHILD: "1",
      OPENBOT_LOCAL_SERVER_ROOT: config.agentRoot,
      OPENBOT_LOCAL_SERVER_NAME: config.serverName,
      OPENBOT_LOCAL_SERVER_SECRET: config.ownerSecret,
      ...(config.runtimeRoot ? { OPENBOT_LOCAL_SERVER_RUNTIMES: config.runtimeRoot } : {}),
    });
    const child = yield* Effect.try({
      try: () =>
        NodeChildProcess.spawn(
          command,
          [...(config.args ?? []), `--user-data-dir=${config.userDataDirectory}`],
          {
            env: childEnvironment,
            stdio: ["pipe", "pipe", "ignore"],
            windowsHide: true,
          },
        ),
      catch: (cause) => new ManagedHostError({ reason: "spawn", cause }),
    });
    const active: RunningChild = { child, closed: false, stopping: false };
    running = active;
    const ready = Deferred.makeUnsafe<HostReady, ManagedHostError>();
    let buffer = "";
    let settled = false;
    child.stdin?.on("error", () => {});
    child.once("error", (cause) => {
      Deferred.doneUnsafe(ready, Exit.fail(new ManagedHostError({ reason: "spawn", cause })));
    });
    child.once("close", () => {
      active.closed = true;
      Deferred.doneUnsafe(ready, Exit.fail(new ManagedHostError({ reason: "exited" })));
      if (running === active && !active.stopping) state = { status: "failed", reason: "exited" };
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (line.length > MAX_LINE_BYTES) {
          settled = true;
          Deferred.doneUnsafe(ready, Exit.fail(new ManagedHostError({ reason: "readiness" })));
          return;
        }
        if (!line.startsWith(READY_PREFIX)) continue;
        settled = true;
        try {
          Deferred.doneUnsafe(ready, Exit.succeed(parseReady(line)));
        } catch (cause) {
          Deferred.doneUnsafe(
            ready,
            Exit.fail(new ManagedHostError({ reason: "readiness", cause })),
          );
        }
        buffer = "";
        return;
      }
      if (buffer.length > MAX_LINE_BYTES) {
        settled = true;
        Deferred.doneUnsafe(ready, Exit.fail(new ManagedHostError({ reason: "readiness" })));
        buffer = "";
      }
    });
    const result = yield* Deferred.await(ready).pipe(
      Effect.timeoutOrElse({
        duration: config.startupTimeoutMs ?? 90_000,
        orElse: () => Effect.fail(new ManagedHostError({ reason: "timeout" })),
      }),
    );
    if (active.closed) return yield* new ManagedHostError({ reason: "exited" });
    state = { status: "ready", ready: result };
    return result;
  });

  return ManagedHost.of({
    getStatus: Effect.sync(() => state),
    start: gate.withPermit(
      start().pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            yield* stopOwned();
            if (config) state = { status: "failed", reason: error.reason };
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* stopOwned();
            state = { status: executablePath ? "stopped" : "disabled" };
          }),
        ),
      ),
    ),
    stop: gate.withPermit(
      Effect.gen(function* () {
        yield* stopOwned();
        state = { status: executablePath ? "stopped" : "disabled" };
      }),
    ),
    switchExecutable: Effect.fn("ManagedHost.switchExecutable")(function* (
      selected: string | null,
    ) {
      if (!config?.allowExecutableSwitch || (selected !== null && !NodePath.isAbsolute(selected)))
        return yield* new ManagedHostError({ reason: "configuration" });
      if (disposed) return yield* new ManagedHostError({ reason: "exited" });
      if (selected === executablePath && state.status === "ready") return state.ready;
      const previous = executablePath;
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* stopOwned();
          executablePath = selected ?? undefined;
          state = { status: selected ? "stopped" : "disabled" };
          if (selected === null) return null;
          return yield* restore(start()).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Effect.gen(function* () {
                    yield* stopOwned();
                    executablePath = previous;
                    state = { status: previous ? "stopped" : "disabled" };
                    if (previous)
                      yield* start().pipe(
                        Effect.catch((error) =>
                          Effect.gen(function* () {
                            yield* stopOwned();
                            state = { status: "failed", reason: error.reason };
                          }),
                        ),
                      );
                  }),
            ),
          );
        }),
      );
    }, gate.withPermits(1)),
  });
});

export const layer = (config: ManagedHostConfig | undefined) =>
  Layer.effect(ManagedHost, make(config));
