// @effect-diagnostics nodeBuiltinImport:off -- Authored package and patch hashes bind real local Git/build fixture execution.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ThreadId, type OpenbotCompatibilityRunInput } from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Projection from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Packaging from "./CompatibilityPackaging.ts";
import * as Runner from "./CompatibilityRunner.ts";
import * as Evidence from "./CompatibilityEvidence.ts";
import * as Profiles from "./ProfileRecovery.ts";
import { EventId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
const sha = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
it.live(
  "refuses promotion when trusted packaging fails after the reviewed source builds",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        process = yield* ProcessRunner.ProcessRunner;
      const worktree = yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-compatibility-" });
      const source = path.join(worktree, ".openbot-build", "source");
      yield* fs.makeDirectory(path.join(source, "scripts"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "node_modules", "electron-vite", "bin"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(source, "package.json"),
        stableStringify({
          name: "openbot",
          scripts: {
            build: "electron-vite build",
            "typecheck:node": "bun scripts/type-checker.ts --noEmit -p tsconfig.node.json",
          },
        }),
      );
      yield* fs.writeFileString(path.join(source, "source.txt"), "before\n");
      yield* fs.writeFileString(
        path.join(source, "scripts", "type-checker.ts"),
        'import {readFileSync} from "node:fs"; if(readFileSync("source.txt","utf8")!=="after\\n")process.exit(2);',
      );
      yield* fs.writeFileString(
        path.join(source, "node_modules", "electron-vite", "bin", "electron-vite.js"),
        'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("out",{recursive:true});writeFileSync("out/runtime.zip","authored-built-package");',
      );
      const git = Effect.fn("test.compatibilityGit")(function* (args: ReadonlyArray<string>) {
        const result = yield* process.run({ command: "git", args, cwd: source });
        expect(result.code).toBe(0);
        return result.stdout.trim();
      });
      yield* git(["init"]);
      yield* git(["add", "package.json", "source.txt", "scripts"]);
      yield* git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "fixture baseline",
      ]);
      const commit = yield* git(["rev-parse", "HEAD"]);
      const patch =
        "diff --git a/source.txt b/source.txt\n--- a/source.txt\n+++ b/source.txt\n@@ -1 +1 @@\n-before\n+after\n";
      yield* fs.writeFileString(path.join(worktree, "reviewed.patch"), patch);
      const input: OpenbotCompatibilityRunInput = {
        runId: "fixture-check",
        threadId: ThreadId.make("actual-fixture-thread"),
        identity: {
          releaseCommit: commit,
          patchSetSha256: sha(stableStringify([["reviewed.patch", sha(patch)]])),
          artifactSha256: sha("authored-built-package"),
          profileSchemaVersion: "fixture-1",
          fixtureVersion: "fixture-1",
        },
        artifactRelativePath: "out/runtime.zip",
        patchRelativePaths: ["reviewed.patch"],
      };
      const now = DateTime.makeUnsafe("2026-11-04T18:00:00Z");
      const projection = Projection.emptyProjection({
        id: EventId.make("created"),
        type: "thread.created",
        threadId: input.threadId,
        occurredAt: now,
        payload: {
          id: input.threadId,
          projectId: ProjectId.make("fixture"),
          title: "fixture",
          providerInstanceId: ProviderInstanceId.make("replay"),
          modelSelection: { instanceId: ProviderInstanceId.make("replay"), model: "free" },
          createdBy: "system",
          creationSource: "server",
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: "fixture",
          worktreePath: worktree,
          activeProviderThreadId: null,
          lineage: {
            parentThreadId: null,
            rootThreadId: input.threadId,
            relationshipToParent: null,
          },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
      const layer = Runner.layer.pipe(
        Layer.provide(Runner.layerUnconfiguredChecks),
        Layer.provide(Layer.succeed(Packaging.CompatibilityPackaging, {
          package: () => Effect.fail(new Packaging.PackagingError({ cause: new Error("Pinned packaging tool unavailable") })),
        })),
        Layer.provide(Evidence.layer),
        Layer.provide(Profiles.layer({ stateDirectory: path.join(worktree, "state") })),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadProjection: () => Effect.succeed(projection),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const runner = yield* Runner.CompatibilityRunner;
        const result = yield* runner.run(input);
        expect(result, stableStringify(result)).toMatchObject({ state: "failed" });
        expect(
          result.checks.filter((check) => check.outcome === "passed").map((check) => check.kind),
        ).toEqual(["source", "patches"]);
        expect(yield* fs.readFileString(path.join(source, "source.txt"))).toBe("after\n");
        expect((yield* runner.run(input).pipe(Effect.flip)).reason).toBe("identity");
        expect(
          (yield* runner
            .run({ ...input, identity: { ...input.identity, artifactSha256: "f".repeat(64) } })
            .pipe(Effect.flip)).reason,
        ).toBe("identity");
      }).pipe(Effect.provide(layer));
      yield* Effect.gen(function* () {
        const evidence = yield* Evidence.CompatibilityEvidence;
        expect(
          (yield* evidence.requireEligible(input.runId, input.identity).pipe(Effect.flip)).reason,
        ).toBe("incomplete");
      }).pipe(Effect.provide(Evidence.layer));
    }).pipe(
      Effect.scoped,
      Effect.provideService(Runner.CompatibilityBuildTools, { bun: process.execPath }),
      Effect.provide(
        Layer.mergeAll(Sqlite.layerMemory, ProcessRunner.layer, NodeCryptoLayer.layer).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
