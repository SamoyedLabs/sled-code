// @effect-diagnostics nodeBuiltinImport:off -- This Node filesystem adapter streams immutable profile backup hashes.
import * as NodeCrypto from "node:crypto";
import * as Stream from "effect/Stream";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { OpenbotCompatibilityIdentity } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
const Manifest = Schema.Struct({
  id: Schema.String,
  identity: OpenbotCompatibilityIdentity,
  backupSha256: Schema.String,
  state: Schema.Literals(["prepared", "migrating", "ready", "aborted", "restored", "rolled-back"]),
  updatedAt: Schema.String,
});
export type ProfileManifest = typeof Manifest.Type;
export class ProfileRecoveryError extends Schema.TaggedError<ProfileRecoveryError>()(
  "OpenbotProfileRecoveryError",
  {
    reason: Schema.Literals(["path", "state", "storage"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
export class ProfileRecovery extends Context.Service<
  ProfileRecovery,
  {
    readonly prepare: (input: {
      readonly id: string;
      readonly identity: typeof OpenbotCompatibilityIdentity.Type;
    }) => Effect.Effect<ProfileManifest, ProfileRecoveryError>;
    readonly get: (id: string) => Effect.Effect<ProfileManifest, ProfileRecoveryError>;
    readonly transition: (
      id: string,
      expected: ProfileManifest["state"],
      action: "migrate" | "complete" | "abort" | "restore" | "rollback",
    ) => Effect.Effect<ProfileManifest, ProfileRecoveryError>;
    readonly directory: (id: string) => Effect.Effect<string, ProfileRecoveryError>;
  }
>()("t3/openbot/ProfileRecovery") {}
const isProfileRecoveryError = Schema.is(ProfileRecoveryError);
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(Manifest));
const make = Effect.fn("ProfileRecovery.make")(
  function* (config: { readonly stateDirectory: string }) {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path,
      gate = yield* Semaphore.make(1);
    const mapped = (cause: unknown) =>
      isProfileRecoveryError(cause)
        ? cause
        : new ProfileRecoveryError({ reason: "storage", cause });
    if (
      !path.isAbsolute(config.stateDirectory) ||
      path.resolve(config.stateDirectory) === path.parse(config.stateDirectory).root
    )
      return yield* new ProfileRecoveryError({ reason: "path" });
    yield* fs.makeDirectory(config.stateDirectory, { recursive: true, mode: 0o700 });
    const root = path.join(
      yield* fs.realPath(config.stateDirectory),
      "openbot",
      "maintenance-profiles",
    );
    yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
    if ((yield* fs.realPath(root)) !== root)
      return yield* new ProfileRecoveryError({ reason: "path" });
    const directory = Effect.fn("ProfileRecovery.directory")(function* (id: string) {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id))
        return yield* new ProfileRecoveryError({ reason: "path" });
      const destination = path.join(root, id);
      if (yield* fs.exists(destination))
        if ((yield* fs.realPath(destination)) !== destination)
          return yield* new ProfileRecoveryError({ reason: "path" });
      return destination;
    }, Effect.mapError(mapped));
    const get = Effect.fn("ProfileRecovery.get")(function* (id: string) {
      return yield* decodeManifest(
        yield* fs.readFileString(path.join(yield* directory(id), "manifest.json")),
      );
    }, Effect.mapError(mapped));
    const write = Effect.fn("ProfileRecovery.write")(function* (manifest: ProfileManifest) {
      const home = yield* directory(manifest.id);
      yield* fs.makeDirectory(home, { recursive: true, mode: 0o700 });
      const file = path.join(home, "manifest.json"),
        pending = path.join(home, "manifest.pending");
      yield* fs.writeFileString(pending, yield* encodeManifest(manifest), { mode: 0o600 });
      yield* fs.rename(pending, file);
      return manifest;
    }, Effect.mapError(mapped));
    const safeTree: (directory: string) => Effect.Effect<void, ProfileRecoveryError> = Effect.fn(
      "ProfileRecovery.safeTree",
    )(function* (directory: string) {
      const names = yield* fs.readDirectory(directory);
      for (const name of names) {
        const entry = path.join(directory, name);
        const stat = yield* fs.stat(entry);
        if (stat.type === "SymbolicLink" || (yield* fs.realPath(entry)) !== entry)
          return yield* new ProfileRecoveryError({ reason: "path" });
        if (stat.type === "Directory") yield* safeTree(entry);
        else if (stat.type !== "File") return yield* new ProfileRecoveryError({ reason: "path" });
      }
    }, Effect.mapError(mapped));
    const treeHash = Effect.fn("ProfileRecovery.treeHash")(function* (directory: string) {
      yield* safeTree(directory);
      const pending = [directory],
        entries: Array<readonly [string, string]> = [];
      while (pending.length > 0) {
        const current = pending.pop()!;
        for (const name of (yield* fs.readDirectory(current)).toSorted()) {
          const entry = path.join(current, name),
            stat = yield* fs.stat(entry);
          if (stat.type === "Directory") pending.push(entry);
          else {
            const hash = NodeCrypto.createHash("sha256");
            yield* fs.stream(entry).pipe(
              Stream.runForEach((chunk) =>
                Effect.sync(() => {
                  hash.update(chunk);
                }),
              ),
            );
            entries.push([path.relative(directory, entry), hash.digest("hex")]);
          }
        }
      }
      return NodeCrypto.createHash("sha256")
        .update(stableStringify(entries.toSorted(([left], [right]) => left.localeCompare(right))))
        .digest("hex");
    }, Effect.mapError(mapped));
    const prepare = Effect.fn("ProfileRecovery.prepare")(
      function* (input: {
        readonly id: string;
        readonly identity: typeof OpenbotCompatibilityIdentity.Type;
      }) {
        const home = yield* directory(input.id);
        if (yield* fs.exists(path.join(home, "manifest.json")))
          return yield* new ProfileRecoveryError({ reason: "state" });
        yield* fs.makeDirectory(path.join(home, "seed"), { recursive: true, mode: 0o700 });
        yield* safeTree(path.join(home, "seed"));
        yield* fs.copy(path.join(home, "seed"), path.join(home, "backup"), { overwrite: false });
        yield* fs.copy(path.join(home, "backup"), path.join(home, "working"), { overwrite: false });
        return yield* write({
          id: input.id,
          identity: input.identity,
          backupSha256: yield* treeHash(path.join(home, "backup")),
          state: "prepared",
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
      },
      Effect.mapError(mapped),
      gate.withPermits(1),
    );
    const transition = Effect.fn("ProfileRecovery.transition")(
      function* (
        id: string,
        expected: ProfileManifest["state"],
        action: "migrate" | "complete" | "abort" | "restore" | "rollback",
      ) {
        const previous = yield* get(id);
        if (previous.state !== expected)
          return yield* new ProfileRecoveryError({ reason: "state" });
        const home = yield* directory(id);
        const state =
          action === "migrate" && expected === "prepared"
            ? "migrating"
            : action === "complete" && expected === "migrating"
              ? "ready"
              : action === "abort" && (expected === "migrating" || expected === "prepared")
                ? "aborted"
                : action === "restore" && (expected === "aborted" || expected === "migrating")
                  ? "restored"
                  : action === "rollback" && expected === "ready"
                    ? "rolled-back"
                    : null;
        if (state === null) return yield* new ProfileRecoveryError({ reason: "state" });
        if (action === "restore" || action === "rollback") {
          if ((yield* treeHash(path.join(home, "backup"))) !== previous.backupSha256)
            return yield* new ProfileRecoveryError({ reason: "state" });
          const pending = path.join(home, "restore-pending");
          yield* fs.remove(pending, { recursive: true, force: true });
          yield* fs.copy(path.join(home, "backup"), pending, { overwrite: false });
          const failed = path.join(home, "failed-working");
          yield* fs.remove(failed, { recursive: true, force: true });
          if (yield* fs.exists(path.join(home, "working")))
            yield* fs.rename(path.join(home, "working"), failed);
          yield* fs.rename(pending, path.join(home, "working"));
        }
        return yield* write({
          ...previous,
          state,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
      },
      Effect.mapError(mapped),
      gate.withPermits(1),
    );
    return ProfileRecovery.of({ prepare, get, transition, directory });
  },
  Effect.mapError((cause) =>
    isProfileRecoveryError(cause) ? cause : new ProfileRecoveryError({ reason: "storage", cause }),
  ),
);
export const layer = (config: { readonly stateDirectory: string }) =>
  Layer.effect(ProfileRecovery, make(config));
