// @effect-diagnostics nodeBuiltinImport:off -- Streamed archive hashing and ZIP decoding belong to this Node adapter.
import * as NodeCrypto from "node:crypto";
import * as NodeStream from "@effect/platform-node/NodeStream";
import {
  OpenbotInstalledRuntime,
  OpenbotRuntimeInstallationStatus,
  OpenbotUpstreamStageInput,
  OpenbotUpstreamFailureReason,
  OpenbotStagedRuntime as StagedSchema,
  type OpenbotStagedRuntime,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { openZipArchive } from "../zipArchive.ts";

export class RuntimeInstallationError extends Schema.TaggedError<RuntimeInstallationError>()(
  "OpenbotRuntimeInstallationError",
  { reason: OpenbotUpstreamFailureReason, cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return `Openbot runtime installation failed (${this.reason}).`;
  }
}

export class RuntimeInstallation extends Context.Service<
  RuntimeInstallation,
  {
    readonly getStatus: Effect.Effect<OpenbotRuntimeInstallationStatus, RuntimeInstallationError>;
    readonly install: (
      staged: OpenbotStagedRuntime,
    ) => Effect.Effect<OpenbotInstalledRuntime, RuntimeInstallationError>;
    readonly resolve: (
      input: OpenbotUpstreamStageInput,
    ) => Effect.Effect<OpenbotInstalledRuntime, RuntimeInstallationError>;
    readonly select: (
      runtime: OpenbotInstalledRuntime,
    ) => Effect.Effect<void, RuntimeInstallationError>;
  }
>()("t3/openbot/RuntimeInstallation") {}

const decodeStaged = Schema.decodeUnknownEffect(StagedSchema);
const decodeInput = Schema.decodeUnknownEffect(OpenbotUpstreamStageInput);
const decodeStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OpenbotRuntimeInstallationStatus),
);
const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(OpenbotRuntimeInstallationStatus));
const isInstallationError = Schema.is(RuntimeInstallationError);
const wrapStorage = (cause: unknown) =>
  isInstallationError(cause) ? cause : new RuntimeInstallationError({ reason: "storage", cause });
const executableRelative = (platform: string) =>
  platform.startsWith("darwin-") ? "OpenBot.app/Contents/MacOS/OpenBot" : "OpenBot.AppImage";

const make = Effect.fn("RuntimeInstallation.make")(function* (config: {
  readonly stateDirectory: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gate = yield* Semaphore.make(1);
  if (
    !path.isAbsolute(config.stateDirectory) ||
    path.resolve(config.stateDirectory) === path.parse(config.stateDirectory).root
  )
    return yield* new RuntimeInstallationError({ reason: "configuration" });
  yield* fs
    .makeDirectory(config.stateDirectory, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(wrapStorage));
  const home = yield* fs.realPath(config.stateDirectory).pipe(Effect.mapError(wrapStorage));
  const root = path.join(home, "openbot", "upstream");
  const installs = path.join(root, "installations");
  const statePath = path.join(root, "installation.json");
  const directoryFor = (
    runtime: Pick<OpenbotInstalledRuntime, "version" | "platform" | "sha256">,
  ) => path.join(installs, runtime.version, runtime.platform, runtime.sha256);
  const inside = (parent: string, child: string) => child.startsWith(parent + path.sep);
  const initial: OpenbotRuntimeInstallationStatus = { installed: [], active: null, previous: null };
  const read = Effect.fn("RuntimeInstallation.read")(function* () {
    if (!(yield* fs.exists(statePath))) return initial;
    if ((yield* fs.stat(statePath)).size > 2_097_152n)
      return yield* new RuntimeInstallationError({ reason: "storage" });
    const state = yield* decodeStatus(yield* fs.readFileString(statePath));
    for (const runtime of [
      ...state.installed,
      ...[state.active, state.previous].filter((entry) => entry !== null),
    ]) {
      if (
        runtime.executablePath !==
        path.join(directoryFor(runtime), executableRelative(runtime.platform))
      )
        return yield* new RuntimeInstallationError({ reason: "integrity" });
    }
    return state;
  }, Effect.mapError(wrapStorage));
  const save = Effect.fn("RuntimeInstallation.save")(
    function* (state: OpenbotRuntimeInstallationStatus) {
      yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
      const temporary = yield* fs.makeTempDirectoryScoped({
        directory: root,
        prefix: ".selection-",
      });
      const pending = path.join(temporary, "installation.json");
      yield* fs.writeFileString(pending, yield* encodeStatus(state), { mode: 0o600 });
      yield* fs.rename(pending, statePath);
    },
    Effect.scoped,
    Effect.mapError(wrapStorage),
  );
  const validateExecutable = Effect.fn("RuntimeInstallation.validateExecutable")(function* (
    runtime: OpenbotInstalledRuntime,
  ) {
    const directory = directoryFor(runtime);
    if (runtime.executablePath !== path.join(directory, executableRelative(runtime.platform)))
      return yield* new RuntimeInstallationError({ reason: "integrity" });
    const actual = yield* fs.realPath(runtime.executablePath);
    const info = yield* fs.stat(actual);
    if (
      !inside(directory, actual) ||
      info.type !== "File" ||
      info.size === 0n ||
      (info.mode & 0o111) === 0
    )
      return yield* new RuntimeInstallationError({ reason: "integrity" });
    return runtime;
  }, Effect.mapError(wrapStorage));
  const resolve = Effect.fn("RuntimeInstallation.resolve")(function* (
    raw: OpenbotUpstreamStageInput,
  ) {
    const input = yield* decodeInput(raw).pipe(
      Effect.mapError((cause) => new RuntimeInstallationError({ reason: "metadata", cause })),
    );
    const runtime = (yield* read()).installed.find(
      (entry) => entry.version === input.version && entry.platform === input.platform,
    );
    if (!runtime) return yield* new RuntimeInstallationError({ reason: "not-installed" });
    return yield* validateExecutable(runtime);
  });
  const extract = Effect.fn("RuntimeInstallation.extract")(
    function* (archivePath: string, destination: string) {
      const unsafe = new RuntimeInstallationError({ reason: "archive" });
      const archive = yield* openZipArchive(
        archivePath,
        (_detail, cause) => new RuntimeInstallationError({ reason: "archive", cause }),
      );
      if (archive.entryCount > 100_000) return yield* unsafe;
      const names = new Set<string>();
      const links: Array<{ name: string; target: string }> = [];
      let total = 0;
      for (;;) {
        const entry = yield* archive.next;
        if (!entry) break;
        const name = entry.fileName;
        const normalized = name.replace(/\/$/, "");
        const mode = entry.externalFileAttributes >>> 16;
        const kind = mode & 0o170000;
        const directory = name.endsWith("/");
        if (
          !name.startsWith("OpenBot.app/") ||
          name.includes("\\") ||
          name.includes("\0") ||
          name.split("/").some((part) => part === ".." || part === ".") ||
          names.has(normalized) ||
          ![0, 0o100000, 0o040000, 0o120000].includes(kind) ||
          (directory && kind !== 0 && kind !== 0o040000) ||
          (entry.generalPurposeBitFlag & 1) !== 0 ||
          ![0, 8].includes(entry.compressionMethod)
        )
          return yield* unsafe;
        names.add(normalized);
        const target = path.resolve(destination, name);
        total += entry.uncompressedSize;
        if (
          !inside(destination, target) ||
          total > 8_589_934_592 ||
          entry.uncompressedSize > 2_147_483_648
        )
          return yield* unsafe;
        if (directory) {
          yield* fs.makeDirectory(target, { recursive: true, mode: 0o755 });
          continue;
        }
        yield* fs.makeDirectory(path.dirname(target), { recursive: true, mode: 0o755 });
        if (kind === 0o120000) {
          if (entry.uncompressedSize > 4096) return yield* unsafe;
          const bytes = yield* Effect.gen(function* () {
            const readable = yield* archive.streamEntry(entry);
            return yield* NodeStream.fromReadable<Uint8Array, RuntimeInstallationError>({
              evaluate: () => readable,
              onError: (cause) => new RuntimeInstallationError({ reason: "archive", cause }),
            }).pipe(Stream.runCollect);
          }).pipe(Effect.scoped);
          const link = new TextDecoder().decode(Buffer.concat(bytes));
          if (
            !link ||
            link.includes("\0") ||
            link.includes("\\") ||
            path.isAbsolute(link) ||
            !inside(destination, path.resolve(path.dirname(target), link))
          )
            return yield* unsafe;
          links.push({ name: target, target: link });
        } else {
          yield* Effect.gen(function* () {
            const readable = yield* archive.streamEntry(entry);
            yield* NodeStream.fromReadable<Uint8Array, RuntimeInstallationError>({
              evaluate: () => readable,
              onError: (cause) => new RuntimeInstallationError({ reason: "archive", cause }),
            }).pipe(
              Stream.run(fs.sink(target, { flag: "wx", mode: mode & 0o111 ? 0o755 : 0o644 })),
            );
          }).pipe(Effect.scoped);
        }
      }
      // Framework links are created last so archive members cannot write through them.
      for (const link of links) yield* fs.symlink(link.target, link.name);
      for (const link of links)
        if (!inside(destination, yield* fs.realPath(link.name))) return yield* unsafe;
    },
    Effect.scoped,
    Effect.mapError((cause) =>
      isInstallationError(cause)
        ? cause
        : new RuntimeInstallationError({ reason: "archive", cause }),
    ),
  );
  const install = Effect.fn("RuntimeInstallation.install")(
    function* (raw: OpenbotStagedRuntime) {
      const staged = yield* decodeStaged(raw).pipe(
        Effect.mapError((cause) => new RuntimeInstallationError({ reason: "metadata", cause })),
      );
      if (staged.platform === "win32-x64")
        return yield* new RuntimeInstallationError({ reason: "unsupported-platform" });
      const expected = path.join(root, "artifacts", staged.version, staged.sha256, staged.name);
      const declared = path.join(
        config.stateDirectory,
        "openbot",
        "upstream",
        "artifacts",
        staged.version,
        staged.sha256,
        staged.name,
      );
      if (
        staged.name.includes("/") ||
        staged.name.includes("\\") ||
        staged.name === "." ||
        staged.name === ".." ||
        path.resolve(staged.artifactPath) !== path.resolve(declared) ||
        (yield* fs.realPath(staged.artifactPath)) !== expected
      )
        return yield* new RuntimeInstallationError({ reason: "integrity" });
      const hash = NodeCrypto.createHash("sha256");
      let bytes = 0;
      yield* fs.stream(expected).pipe(
        Stream.runForEach((chunk) =>
          Effect.suspend(() => {
            bytes += chunk.length;
            if (bytes > staged.size)
              return Effect.fail(new RuntimeInstallationError({ reason: "integrity" }));
            hash.update(chunk);
            return Effect.void;
          }),
        ),
      );
      if (bytes !== staged.size || hash.digest("hex") !== staged.sha256)
        return yield* new RuntimeInstallationError({ reason: "integrity" });
      const state = yield* read();
      const existing = state.installed.find(
        (entry) =>
          entry.version === staged.version &&
          entry.platform === staged.platform &&
          entry.sha256 === staged.sha256,
      );
      if (existing) return yield* validateExecutable(existing);
      yield* fs.makeDirectory(installs, { recursive: true, mode: 0o700 });
      const temporary = yield* fs.makeTempDirectoryScoped({
        directory: installs,
        prefix: ".install-",
      });
      const unpacked = path.join(temporary, "runtime");
      yield* fs.makeDirectory(unpacked, { mode: 0o700 });
      if (staged.platform.startsWith("darwin-")) yield* extract(expected, unpacked);
      else {
        yield* fs.copyFile(expected, path.join(unpacked, executableRelative(staged.platform)));
        yield* fs.chmod(path.join(unpacked, executableRelative(staged.platform)), 0o755);
      }
      const directory = directoryFor(staged);
      const runtime: OpenbotInstalledRuntime = {
        version: staged.version,
        platform: staged.platform,
        sha256: staged.sha256,
        releaseCommit: staged.releaseCommit,
        executablePath: path.join(directory, executableRelative(staged.platform)),
        installedAt: DateTime.formatIso(yield* DateTime.now),
        compatibility: staged.compatibility,
      };
      const pendingExecutable = path.join(unpacked, executableRelative(staged.platform));
      const actual = yield* fs
        .realPath(pendingExecutable)
        .pipe(
          Effect.mapError((cause) => new RuntimeInstallationError({ reason: "archive", cause })),
        );
      const info = yield* fs.stat(actual);
      if (
        !inside(unpacked, actual) ||
        info.type !== "File" ||
        info.size === 0n ||
        (info.mode & 0o111) === 0
      )
        return yield* new RuntimeInstallationError({ reason: "archive" });
      yield* fs.makeDirectory(path.dirname(directory), { recursive: true, mode: 0o700 });
      if (yield* fs.exists(directory)) yield* fs.remove(directory, { recursive: true });
      yield* fs.rename(unpacked, directory);
      yield* validateExecutable(runtime);
      yield* save({
        ...state,
        installed: [
          ...state.installed.filter(
            (entry) => !(entry.version === runtime.version && entry.platform === runtime.platform),
          ),
          runtime,
        ].slice(-100),
      });
      return runtime;
    },
    Effect.scoped,
    Effect.mapError(wrapStorage),
    gate.withPermits(1),
  );
  const select = Effect.fn("RuntimeInstallation.select")(function* (
    runtime: OpenbotInstalledRuntime,
  ) {
    const current = yield* resolve(runtime);
    if (current.sha256 !== runtime.sha256)
      return yield* new RuntimeInstallationError({ reason: "integrity" });
    const state = yield* read();
    if (state.active?.sha256 === current.sha256 && state.active.platform === current.platform)
      return;
    yield* save({ ...state, active: current, previous: state.active });
  }, gate.withPermits(1));
  return RuntimeInstallation.of({ getStatus: read(), install, resolve, select });
});

export const layer = (config: { readonly stateDirectory: string }) =>
  Layer.effect(RuntimeInstallation, make(config));
