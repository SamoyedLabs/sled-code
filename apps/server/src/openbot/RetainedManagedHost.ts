// @effect-diagnostics globalTimers:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off -- retained OS owner protocol runs outside Effect fibers.
// @effect-diagnostics nodeBuiltinImport:off -- retained supervisor transport and bootstrap.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeSea from "node:sea";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as ManagedHost from "./ManagedHost.ts";
import type { PrivilegedOwnerConfiguration } from "./PrivilegedOwnerWorker.ts";

interface OwnerDescriptor {
  state: "starting" | "ready" | "exited";
  incarnation?: string;
  socketPath?: string;
  ready?: ManagedHost.HostReady;
  executablePath?: string;
}
export interface RetainedHostConfiguration {
  readonly host: ManagedHost.ManagedHostConfig;
  readonly authDatabase: string;
  readonly activationConfigPath?: string | undefined;
  readonly ownerDirectory: string;
  readonly controllerKey: string;
}
const unavailable = () => new Error("Privileged owner pending or unavailable");
async function control(descriptor: OwnerDescriptor, key: string, operation: "status" | "fence") {
  if (!descriptor.socketPath || !descriptor.incarnation) throw unavailable();
  return new Promise<{ ok: boolean; exited?: boolean }>((resolve, reject) => {
    const socket = NodeNet.connect(descriptor.socketPath!);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(unavailable());
    }, 10000);
    socket.on("error", () => {
      clearTimeout(timer);
      reject(unavailable());
    });
    socket.on("connect", () =>
      socket.write(JSON.stringify({ key, operation, incarnation: descriptor.incarnation }) + "\n"),
    );
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 16384) {
        socket.destroy();
        clearTimeout(timer);
        reject(unavailable());
      }
    });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(buffer);
        if (
          reply.ok !== true ||
          reply.incarnation !== descriptor.incarnation ||
          (operation === "fence" && reply.exited !== true)
        )
          throw unavailable();
        resolve(reply);
      } catch {
        reject(unavailable());
      }
    });
  });
}
const make = Effect.fn("RetainedManagedHost.make")(function* (
  configuration: RetainedHostConfiguration,
) {
  const gate = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<ManagedHost.HostStatus>();
  let state: ManagedHost.HostStatus = {
    status: configuration.host.executablePath ? "stopped" : "disabled",
  };
  let executable = configuration.host.executablePath;
  let startingOwner: NodeChildProcess.ChildProcess | undefined;
  const descriptorPath = NodePath.join(configuration.ownerDirectory, "owner.json");
  const read = async (): Promise<OwnerDescriptor | undefined> => {
    try {
      return JSON.parse(await NodeFSP.readFile(descriptorPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw unavailable();
    }
  };
  const setState = (value: ManagedHost.HostStatus) => {
    state = value;
    PubSub.publishUnsafe(events, value);
  };
  const stop = Effect.fn("RetainedManagedHost.stop")(function* () {
    yield* Effect.promise(async () => {
      const descriptor = await read();
      if (descriptor?.state === "starting" && startingOwner) {
        const exit = NodeEvents.EventEmitter.once(startingOwner, "exit");
        startingOwner.kill("SIGTERM");
        await exit;
        if ((await read())?.state !== "exited") throw unavailable();
      } else if (descriptor && descriptor.state !== "exited")
        await control(descriptor, configuration.controllerKey, "fence");
    });
    setState({ status: executable ? "stopped" : "disabled" });
  });
  const start = Effect.fn("RetainedManagedHost.start")(function* () {
    if (!executable) return yield* new ManagedHost.ManagedHostError({ reason: "disabled" });
    const command = executable;
    setState({ status: "starting" });
    const ready = yield* Effect.tryPromise({
      try: async () => {
        const environmentId = configuration.host.sledEnvironmentId;
        if (!environmentId) throw unavailable();
        await NodeFSP.mkdir(configuration.ownerDirectory, { recursive: true, mode: 0o700 });
        await NodeFSP.mkdir(configuration.host.userDataDirectory, { recursive: true, mode: 0o700 });
        await NodeFSP.mkdir(configuration.host.agentRoot, { recursive: true, mode: 0o700 });
        let descriptor = await read();
        if (descriptor?.state === "ready") {
          if (descriptor.executablePath !== command) throw unavailable();
          await control(descriptor, configuration.controllerKey, "status");
          if (!descriptor.ready) throw unavailable();
          return descriptor.ready;
        }
        if (descriptor?.state === "starting") throw unavailable();
        if (descriptor?.state === "exited") await NodeFSP.unlink(descriptorPath);
        // @effect-diagnostics-next-line globalJsonInEffect:off
        await NodeFSP.writeFile(descriptorPath, JSON.stringify({ state: "starting" }), {
          flag: "wx",
          mode: 0o600,
        });
        const socketDirectory = await NodeFSP.mkdtemp("/tmp/sled-owner-");
        const socketPath = NodePath.join(socketDirectory, "control.sock");
        const config: PrivilegedOwnerConfiguration = {
          host: {
            ...configuration.host,
            executablePath: command,
            sledEnvironmentId: environmentId,
          },
          authDatabase: configuration.authDatabase,
          activationConfigPath: configuration.activationConfigPath,
          controllerKey: configuration.controllerKey,
          socketPath,
          descriptorPath,
        };
        const owner = NodeChildProcess.spawn(
          process.execPath,
          [...(NodeSea.isSea() ? [] : [process.argv[1]!]), "__openbot-privileged-owner"],
          {
            detached: true,
            stdio: ["ignore", "ignore", "ignore", "pipe"],
            windowsHide: true,
          },
        );
        startingOwner = owner;
        owner.on("error", () => {});
        const pipe = owner.stdio[3];
        if (!pipe || !("end" in pipe)) throw unavailable();
        pipe.on("error", () => {});
        // @effect-diagnostics-next-line globalJsonInEffect:off
        pipe.end(JSON.stringify(config));
        owner.unref();
        const deadline = Date.now() + (configuration.host.startupTimeoutMs ?? 90000);
        do {
          descriptor = await read();
          if (descriptor?.state === "ready") {
            await control(descriptor, configuration.controllerKey, "status");
            if (!descriptor.ready) throw unavailable();
            startingOwner = undefined;
            return descriptor.ready;
          }
          if (descriptor?.state === "exited") throw unavailable();
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (Date.now() < deadline);
        throw unavailable();
      },
      catch: (cause) => new ManagedHost.ManagedHostError({ reason: "readiness", cause }),
    }).pipe(
      Effect.tapError(() => Effect.sync(() => setState({ status: "failed", reason: "readiness" }))),
    );
    setState({ status: "ready", ready });
    return ready;
  });
  yield* Effect.addFinalizer(() => gate.withPermit(stop()));
  yield* Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep("1 second");
      if (state.status !== "ready") continue;
      const observed = yield* Effect.tryPromise({
        try: async () => {
          const descriptor = await read();
          if (descriptor?.state === "exited") return "exited" as const;
          if (descriptor?.state !== "ready") throw unavailable();
          await control(descriptor, configuration.controllerKey, "status");
          return "ready" as const;
        },
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => "unknown" as const));
      if (state.status === "ready" && observed !== "ready")
        setState({ status: "failed", reason: observed === "exited" ? "exited" : "readiness" });
    }
  }).pipe(Effect.forkScoped);

  return ManagedHost.ManagedHost.of({
    getStatus: Effect.sync(() => state),
    changes: Stream.fromPubSub(events),
    start: gate.withPermit(start()),
    stop: gate.withPermit(stop()),
    switchExecutable: Effect.fn("RetainedManagedHost.switchExecutable")(function* (
      selected: string | null,
      options?: { readonly start?: boolean },
    ) {
      if (!configuration.host.allowExecutableSwitch)
        return yield* new ManagedHost.ManagedHostError({ reason: "configuration" });
      yield* stop();
      executable = selected ?? undefined;
      return selected !== null && options?.start !== false ? yield* start() : null;
    }, gate.withPermits(1)),
  });
});
export const layer = (configuration: RetainedHostConfiguration) =>
  Layer.effect(ManagedHost.ManagedHost, make(configuration));
