import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  OpenbotCompatibilityEvidence,
  OpenbotCompatibilityRunInput,
  type OpenbotCompatibilityCheck,
  type OpenbotCompatibilityIdentity,
} from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Profiles from "./ProfileRecovery.ts";
import * as Packaging from "./CompatibilityPackaging.ts";
export const CompatibilityBuildTools = Context.Reference<{ readonly bun: string; readonly managedBunRoot?: string }>(
  "t3/openbot/CompatibilityRunner/CompatibilityBuildTools",
  { defaultValue: () => ({ bun: "bun" }) },
);
export class CompatibilityRunnerError extends Schema.TaggedError<CompatibilityRunnerError>()(
  "OpenbotCompatibilityRunnerError",
  {
    reason: Schema.Literals(["identity", "workspace", "storage", "check"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
export class CompatibilityChecks extends Context.Service<
  CompatibilityChecks,
  {
    readonly run: (input: {
      readonly identity: OpenbotCompatibilityIdentity;
      readonly sourceDirectory: string;
      readonly artifactPath: string;
      readonly profileDirectory: string;
    }) => Effect.Effect<ReadonlyArray<OpenbotCompatibilityCheck>, CompatibilityRunnerError>;
  }
>()("t3/openbot/CompatibilityRunner/CompatibilityChecks") {}
export const layerUnconfiguredChecks = Layer.succeed(CompatibilityChecks, {
  run: Effect.fn("CompatibilityChecks.unconfigured")(() =>
    Effect.succeed(
      (["transport", "desktop", "native", "profile-migration", "rollback"] as const).map(
        (kind) => ({
          kind,
          outcome: "not-run" as const,
          detail: "A configured independent compatibility fixture has not run.",
        }),
      ),
    ),
  ),
});
export class CompatibilityRunner extends Context.Service<
  CompatibilityRunner,
  {
    readonly preparedInput: (
      threadId: OpenbotCompatibilityRunInput["threadId"],
      runId: string,
    ) => Effect.Effect<OpenbotCompatibilityRunInput, CompatibilityRunnerError>;
    readonly run: (
      input: OpenbotCompatibilityRunInput,
    ) => Effect.Effect<OpenbotCompatibilityEvidence, CompatibilityRunnerError>;
  }
>()("t3/openbot/CompatibilityRunner") {}
const isCompatibilityRunnerError = Schema.is(CompatibilityRunnerError);
const decodeRunInput = Schema.decodeEffect(OpenbotCompatibilityRunInput);
const decodePreparedInput = Schema.decodeEffect(
  Schema.fromJsonString(OpenbotCompatibilityRunInput),
);
const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(OpenbotCompatibilityEvidence));
const decodePackage = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      scripts: Schema.Struct({ build: Schema.String, "typecheck:node": Schema.String }),
    }),
  ),
);
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient,
    fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    digest = yield* Digest.Digest;
  const threads = yield* ThreadManagement.ThreadManagementService,
    process = yield* ProcessRunner.ProcessRunner,
    checks = yield* CompatibilityChecks,
    profiles = yield* Profiles.ProfileRecovery;
  const packaging = yield* Packaging.CompatibilityPackaging;
  const gate = yield* Semaphore.make(1);
  const environment = yield* HostProcess.Environment;
  const tools = yield* CompatibilityBuildTools;
  const hostPlatform=yield* HostProcess.Platform;
  const hostArchitecture=yield* HostProcess.Architecture;
  const mapped = (cause: unknown) =>
    isCompatibilityRunnerError(cause)
      ? cause
      : new CompatibilityRunnerError({ reason: "check", cause });
  const hash = Effect.fn("CompatibilityRunner.hash")(function* (bytes: Uint8Array) {
    return Hex.encode(yield* digest.digest(Digest.sha256, bytes));
  });
  const within = Effect.fn("CompatibilityRunner.within")(function* (
    root: string,
    relative: string,
  ) {
    if (
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === "..")
    )
      return yield* new CompatibilityRunnerError({ reason: "workspace" });
    const destination = path.resolve(root, relative),
      actual = yield* fs.realPath(destination);
    if (!actual.startsWith(root + path.sep) || actual !== destination)
      return yield* new CompatibilityRunnerError({ reason: "workspace" });
    return actual;
  });
  const resolveBun=Effect.fn("CompatibilityRunner.resolveBun")(function*(){
    if(tools.bun!=="bun"||tools.managedBunRoot===undefined)return tools.bun;
    const platformRoot=path.join(tools.managedBunRoot,`${hostPlatform}-${hostArchitecture}`);
    if(!(yield* fs.exists(platformRoot)))return tools.bun;
    const canonical=yield* fs.realPath(platformRoot);
    if(canonical!==path.resolve(platformRoot))return yield* new CompatibilityRunnerError({reason:"workspace"});
    const versions=(yield* fs.readDirectory(platformRoot)).filter((version)=>/^\d+\.\d+\.\d+$/.test(version)).sort((left,right)=>{const a=left.split(".").map(Number),b=right.split(".").map(Number);return (b[0]??0)-(a[0]??0)||(b[1]??0)-(a[1]??0)||(b[2]??0)-(a[2]??0);});
    for(const version of versions){
      const executable=path.join(platformRoot,version,"bin",hostPlatform==="win32"?"bun.exe":"bun");
      if(!(yield* fs.exists(executable)))continue;
      const actual=yield* fs.realPath(executable),stat=yield* fs.stat(actual);
      if(actual===executable&&stat.type==="File"&&stat.size>0n&&(hostPlatform==="win32"||(stat.mode&0o111)!==0))return actual;
    }
    return tools.bun;
  });
  const run = Effect.fn("CompatibilityRunner.run")(
    function* (raw: OpenbotCompatibilityRunInput) {
      const input = yield* decodeRunInput(raw);
      let candidateIdentity = input.identity;
      let identity = stableStringify(candidateIdentity);
      const existing = yield* sql<{
        readonly identity_json: string;
        readonly state: string;
      }>`SELECT identity_json,state FROM openbot_compatibility_runs WHERE id=${input.runId}`;
      if (existing[0]) {
        if (existing[0].identity_json !== identity)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        // A previous run may predate trusted packaging; retries require a fresh attempt ID.
        return yield* new CompatibilityRunnerError({ reason: "identity" });
      }
      const projection = yield* threads.getThreadProjection(input.threadId);
      if (projection.thread.deletedAt !== null || projection.thread.worktreePath === null)
        return yield* new CompatibilityRunnerError({ reason: "workspace" });
      const worktree = yield* fs.realPath(projection.thread.worktreePath);
      const source = yield* within(worktree, ".openbot-build/source");
      const packageMetadata = yield* decodePackage(
        yield* fs.readFileString(path.join(source, "package.json")),
      );
      if (
        packageMetadata.name !== "openbot" ||
        packageMetadata.scripts.build !== "electron-vite build" ||
        packageMetadata.scripts["typecheck:node"] !==
          "bun scripts/type-checker.ts --noEmit -p tsconfig.node.json"
      )
        return yield* new CompatibilityRunnerError({ reason: "identity" });
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const initial: OpenbotCompatibilityEvidence = {
        runId: input.runId,
        threadId: input.threadId,
        identity: candidateIdentity,
        state: "running",
        checks: [],
        createdAt,
        completedAt: null,
      };
      yield* sql`INSERT INTO openbot_compatibility_runs(id,identity_json,state,evidence_json,created_at) VALUES(${input.runId},${identity},'running',${yield* encodeEvidence(initial)},${createdAt}) ON CONFLICT(id) DO NOTHING`;
      let packagedArtifactPath: string | undefined;
      const results: OpenbotCompatibilityCheck[] = [];
      const save = Effect.fn("CompatibilityRunner.save")(function* (
        state: OpenbotCompatibilityEvidence["state"],
      ) {
        const final = {
          ...initial,
          identity: candidateIdentity,
          ...(packagedArtifactPath === undefined ? {} : { artifactPath: packagedArtifactPath }),
          state,
          checks: results,
          completedAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* sql`UPDATE openbot_compatibility_runs SET state=${state},evidence_json=${yield* encodeEvidence(final)},completed_at=${final.completedAt} WHERE id=${input.runId} AND state='running'`;
        return final;
      });
      const command = Effect.fn("CompatibilityRunner.command")(function* (
        command: string,
        args: ReadonlyArray<string>,
      ) {
        const taskHome = path.join(worktree, ".openbot-build", "home");
        yield* fs.makeDirectory(taskHome, { recursive: true, mode: 0o700 });
        const env: NodeJS.ProcessEnv = Object.fromEntries(
          Object.keys(environment).map((key) => [key, undefined]),
        );
        for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"])
          if (environment[key] !== undefined) env[key] = environment[key];
        env.HOME = taskHome;
        env.USERPROFILE = taskHome;
        env.XDG_CONFIG_HOME = path.join(taskHome, "config");
        env.GIT_CONFIG_NOSYSTEM = "1";
        env.GIT_CONFIG_GLOBAL = path.join(taskHome, "gitconfig");
        const output = yield* process.run({
          command: command === "bun" ? yield* resolveBun() : command,
          args,
          cwd: source,
          env,
          timeout: "15 minutes",
          maxOutputBytes: 262144,
          outputMode: "truncate",
        });
        if (output.code !== 0)
          return yield* new CompatibilityRunnerError({
            reason: "check",
            cause: new Error((output.stderr || output.stdout || `Command exited with code ${output.code}: ${command}`).slice(-4096)),
          });
        return output.stdout.trim();
      });
      return yield* Effect.gen(function* () {
        const commit = yield* command("git", ["rev-parse", "HEAD"]);
        if (commit !== input.identity.releaseCommit)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        results.push({
          kind: "source",
          outcome: "passed",
          detail: `Verified source commit ${commit}.`,
        });
        const patchHashes: Array<readonly [string, string]> = [];
        for (const relative of input.patchRelativePaths.toSorted()) {
          const patch = yield* within(worktree, relative);
          patchHashes.push([relative, yield* hash(yield* fs.readFile(patch))]);
        }
        const patchSetSha = yield* hash(new TextEncoder().encode(stableStringify(patchHashes)));
        if (patchSetSha !== input.identity.patchSetSha256)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        for (const [relative] of patchHashes) {
          const patch = yield* within(worktree, relative);
          const applied = yield* command("git", ["apply", "--reverse", "--check", patch]).pipe(
            Effect.result,
          );
          if (applied._tag === "Failure") {
            yield* command("git", ["apply", "--check", patch]);
            yield* command("git", ["apply", patch]);
            yield* command("git", ["apply", "--reverse", "--check", patch]);
          }
        }
        results.push({
          kind: "patches",
          outcome: "passed",
          detail: `Verified ${patchHashes.length} applied patches and exact patchset hash.`,
        });
        yield* command("bun", ["scripts/type-checker.ts", "--noEmit", "-p", "tsconfig.node.json"]);
        yield* fs.remove(path.join(source, "out"), { recursive: true, force: true });
        yield* command("bun", ["node_modules/electron-vite/bin/electron-vite.js", "build"]);
        const packaged = yield* packaging.package(source, candidateIdentity);
        candidateIdentity = packaged.identity;
        identity = stableStringify(candidateIdentity);
        const artifactPath = packaged.artifactPath;
        packagedArtifactPath = artifactPath;
        yield* sql`UPDATE openbot_compatibility_runs SET identity_json=${identity} WHERE id=${input.runId} AND state='running'`;
        results.push({
          kind: "build",
          outcome: "passed",
          detail: `Node typecheck/build and trusted packaging passed; build ${packaged.buildSha256}, base ${packaged.baseSha256}, artifact ${candidateIdentity.artifactSha256}.`,
        });
        const profileId = yield* hash(new TextEncoder().encode(input.runId));
        const profile = yield* profiles
          .get(profileId)
          .pipe(Effect.catch(() => profiles.prepare({ id: profileId, identity: candidateIdentity })));
        if (stableStringify(profile.identity) !== identity)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        const profileDirectory = path.join(yield* profiles.directory(profile.id), "working");
        results.push(
          ...(yield* checks.run({
            identity: candidateIdentity,
            sourceDirectory: source,
            artifactPath,
            profileDirectory,
          })),
        );
        if ((yield* hash(yield* fs.readFile(artifactPath))) !== candidateIdentity.artifactSha256)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        yield* Effect.tryPromise({ try: packaged.verify, catch: mapped });
        if (stableStringify(candidateIdentity) !== identity)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        for (const [relative, expected] of patchHashes)
          if ((yield* hash(yield* fs.readFile(yield* within(worktree, relative)))) !== expected)
            return yield* new CompatibilityRunnerError({ reason: "identity" });
        if ((yield* command("git", ["rev-parse", "HEAD"])) !== commit)
          return yield* new CompatibilityRunnerError({ reason: "identity" });
        const required = [
          "source",
          "patches",
          "build",
          "transport",
          "desktop",
          "native",
          "profile-migration",
          "rollback",
        ];
        const eligible =
          required.every((kind) =>
            results.some((check) => check.kind === kind && check.outcome === "passed"),
          ) && !results.some((check) => check.outcome === "failed");
        return yield* save(eligible ? "eligible" : "requires-validation");
      }).pipe(
        Effect.catch((cause) => {
          results.push({
            kind: "build",
            outcome: "failed",
            detail: isCompatibilityRunnerError(cause)
              ? `${cause.reason}: ${cause.cause instanceof Error ? cause.cause.message.slice(-3000) : "Compatibility check failed."}`
              : cause instanceof Error
                ? cause.message.slice(-3000)
                : "An independent compatibility check failed.",
          });
          return save("failed");
        }),
      );
    },
    Effect.mapError(mapped),
    gate.withPermits(1),
  );
  const preparedInput = Effect.fn("CompatibilityRunner.preparedInput")(function* (
    threadId: OpenbotCompatibilityRunInput["threadId"],
    runId: string,
  ) {
    const projection = yield* threads.getThreadProjection(threadId);
    if (projection.thread.deletedAt !== null || projection.thread.worktreePath === null)
      return yield* new CompatibilityRunnerError({ reason: "workspace" });
    const worktree = yield* fs.realPath(projection.thread.worktreePath);
    const file = yield* within(worktree, ".openbot-build/validation-input.json");
    if ((yield* fs.stat(file)).size > 65536n)
      return yield* new CompatibilityRunnerError({ reason: "identity" });
    const input = yield* decodePreparedInput(yield* fs.readFileString(file));
    if (input.threadId !== threadId)
      return yield* new CompatibilityRunnerError({ reason: "identity" });
    return { ...input, runId };
  }, Effect.mapError(mapped));
  return CompatibilityRunner.of({ run, preparedInput });
});
export const layer = Layer.effect(CompatibilityRunner, make);
