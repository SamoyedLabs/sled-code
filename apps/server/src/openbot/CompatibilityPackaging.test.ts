// @effect-diagnostics nodeBuiltinImport:off -- Local packaging and fixtures use Node file and subprocess APIs.
import * as NodeUtil from "node:util";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { packageMacos } from "./CompatibilityPackaging.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
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
import * as Runner from "./CompatibilityRunner.ts";
import * as Evidence from "./CompatibilityEvidence.ts";
import * as Profiles from "./ProfileRecovery.ts";
import { EventId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Packaging from "./CompatibilityPackaging.ts";
const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const configuredAsarCli = process.env.OPENBOT_TEST_ASAR_CLI?.trim() ?? "";
const FIXTURE_ASAR_CLI_SOURCE = `
import * as fs from "node:fs/promises";
import * as path from "node:path";

const [command, source, destination, ...rest] = process.argv.slice(2);
const unpackAll = rest.includes("--unpack");

async function walk(root, relative = "") {
  const dir = path.join(root, relative);
  const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files = {};
  const blobs = [];
  let offset = 0;
  async function visit(currentRel, target) {
    const curDir = path.join(root, currentRel);
    const items = (await fs.readdir(curDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const item of items) {
      const rel = currentRel ? path.join(currentRel, item.name) : item.name;
      const full = path.join(root, rel);
      if (item.isDirectory()) {
        const sub = {};
        target[item.name] = { files: sub };
        await visit(rel, sub);
      } else if (item.isFile()) {
        const data = await fs.readFile(full);
        if (unpackAll) {
          target[item.name] = { size: data.length, unpacked: true };
        } else {
          target[item.name] = { size: data.length, offset: String(offset) };
          blobs.push(data);
          offset += data.length;
        }
      }
    }
  }
  await visit("", files);
  return { header: { files }, blobs };
}

if (command === "pack") {
  const { header, blobs } = await walk(source);
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const pad = (4 - (headerBytes.length % 4)) % 4;
  const headerBuf = Buffer.alloc(16 + headerBytes.length + pad);
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(headerBytes.length + pad + 8, 4);
  headerBuf.writeUInt32LE(headerBytes.length + pad + 4, 8);
  headerBuf.writeUInt32LE(headerBytes.length, 12);
  headerBytes.copy(headerBuf, 16);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.concat([headerBuf, ...blobs]));
  if (unpackAll) {
    await fs.cp(source, destination + ".unpacked", { recursive: true });
  }
} else if (command === "extract") {
  const raw = await fs.readFile(source);
  const headerSize = raw.readUInt32LE(12);
  const dataOffset = 16 + headerSize + ((4 - (headerSize % 4)) % 4);
  const header = JSON.parse(raw.subarray(16, 16 + headerSize).toString("utf8"));
  await fs.mkdir(destination, { recursive: true });
  async function extractTree(node, currentRel) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const rel = currentRel ? path.join(currentRel, name) : name;
      const outPath = path.join(destination, rel);
      if (entry.files) {
        await fs.mkdir(outPath, { recursive: true });
        await extractTree(entry, rel);
      } else if (entry.unpacked) {
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.copyFile(path.join(source + ".unpacked", rel), outPath);
      } else {
        const start = dataOffset + Number(entry.offset);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, raw.subarray(start, start + entry.size));
      }
    }
  }
  await extractTree(header, "");
} else {
  process.exit(1);
}
`;
const identity = {
  releaseCommit: "a".repeat(40),
  patchSetSha256: "b".repeat(64),
  artifactSha256: "c".repeat(64),
  profileSchemaVersion: "fixture",
  fixtureVersion: "fixture",
};
const hash = async (p: string) =>
  NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(p))
    .digest("hex");
async function fixture(version = "0.60.0") {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "packaging-test-"));
  const source = NodePath.join(root, "source"),
    payload = NodePath.join(root, "payload"),
    app = NodePath.join(root, "OpenBot.app"),
    baseArchive = NodePath.join(root, "base.zip");
  const asarCli = configuredAsarCli || NodePath.join(root, "asar-fixture.mjs");
  const write = async (p: string, data: string) => {
    await NodeFSP.mkdir(NodePath.dirname(p), { recursive: true });
    await NodeFSP.writeFile(p, data);
  };
  if (!configuredAsarCli) await write(asarCli, FIXTURE_ASAR_CLI_SOURCE);
  for (const file of ["main/index.js", "preload/index.cjs", "renderer/index.html"])
    await write(NodePath.join(source, "out", file), `rebuilt ${file}`);
  await write(
    NodePath.join(payload, "package.json"),
    JSON.stringify({ name: "openbot", version, main: "./out/main/index.js" }),
  );
  await write(NodePath.join(payload, "node_modules/native/addon.node"), "native fixture bytes");
  await write(NodePath.join(payload, "node_modules/native/LICENSE"), "native license");
  await write(NodePath.join(payload, "out/main/index.js"), "OLD UNRELATED BUILD");
  await write(NodePath.join(app, "Contents/Resources/LICENSE"), "distribution license");
  await write(
    NodePath.join(app, "Contents/Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.openbot</string><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>old</string></dict></dict></dict></plist>',
  );
  await exec(process.execPath, [
    asarCli,
    "pack",
    payload,
    NodePath.join(app, "Contents/Resources/app.asar"),
  ]);
  await exec("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, baseArchive]);
  return {
    root,
    source,
    config: {
      platform: "darwin",
      baseArchive,
      baseSha256: await hash(baseArchive),
      asarCli,
      outputDirectory: NodePath.join(root, "attempts"),
    },
    async [Symbol.asyncDispose]() {
      await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
}
describe.runIf(HostProcess.Platform.defaultValue() === "darwin")("macOS compatibility packaging", () => {
it("packages this build instead of caller archive; binds manifest/output and preserves native/license resources", async () => {
  await using f = await fixture();
  await NodeFSP.writeFile(NodePath.join(f.source, "old.zip"), "unrelated supplied archive");
  const packaged = await packageMacos(f.config, f.source, identity);
  expect(packaged.identity.artifactSha256).not.toBe(identity.artifactSha256);
  expect(packaged.artifactPath.startsWith(f.config.outputDirectory)).toBe(true);
  await packaged.verify();
  await exec("/usr/bin/ditto", [
    "-x",
    "-k",
    packaged.artifactPath,
    NodePath.join(f.root, "inspect"),
  ]);
  const { stdout: agentPolicy } = await exec("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :LSUIElement",
    NodePath.join(f.root, "inspect/OpenBot.app/Contents/Info.plist"),
  ]);
  expect(agentPolicy.trim()).toBe("true");
  const resources = NodePath.join(f.root, "inspect/OpenBot.app/Contents/Resources");
  expect(await NodeFSP.readFile(NodePath.join(resources, "LICENSE"), "utf8")).toBe(
    "distribution license",
  );
  expect(
    await NodeFSP.readFile(
      NodePath.join(resources, "app.asar.unpacked/node_modules/native/addon.node"),
      "utf8",
    ),
  ).toBe("native fixture bytes");
  expect(
    await NodeFSP.readFile(NodePath.join(resources, "app.asar.unpacked/out/main/index.js"), "utf8"),
  ).toBe("rebuilt main/index.js");
  expect(
    await NodeFSP.readFile(
      NodePath.join(resources, "app.asar.unpacked/node_modules/native/LICENSE"),
      "utf8",
    ),
  ).toBe("native license");
  await NodeFSP.appendFile(NodePath.join(f.source, "out/main/index.js"), "drift");
  await expect(packaged.verify()).rejects.toThrow("identity mismatch");
});
it("rejects wrong base and cleans failed attempt without touching base/source/old artifact", async () => {
  await using f = await fixture();
  await expect(
    packageMacos({ ...f.config, baseSha256: "0".repeat(64) }, f.source, identity),
  ).rejects.toThrow("identity mismatch");
  await expect(
    packageMacos(
      { ...f.config, asarCli: NodePath.join(f.root, "missing-tool") },
      f.source,
      identity,
    ),
  ).rejects.toThrow();
  expect(await NodeFSP.readdir(f.config.outputDirectory)).toEqual([]);
  expect(await hash(f.config.baseArchive)).toBe(f.config.baseSha256);
  expect(await NodeFSP.readFile(NodePath.join(f.source, "out/main/index.js"), "utf8")).toBe(
    "rebuilt main/index.js",
  );
});
it("rejects archive and provenance manifest drift", async () => {
  await using f = await fixture();
  const packaged = await packageMacos(f.config, f.source, identity);
  const manifest = NodePath.join(NodePath.dirname(packaged.artifactPath), "provenance.json");
  const original = await NodeFSP.readFile(manifest);
  await NodeFSP.writeFile(manifest, "{}");
  await expect(packaged.verify()).rejects.toThrow("identity mismatch");
  await NodeFSP.writeFile(manifest, original);
  await NodeFSP.appendFile(packaged.artifactPath, "unrelated");
  await expect(packaged.verify()).rejects.toThrow("identity mismatch");
});

const sha = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
it.live(
  "applies a reviewed patch and independently builds in the bound nested source while missing client checks block promotion",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(Effect.promise(() => fixture()));
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
        'import {mkdirSync,writeFileSync} from "node:fs";for(const f of ["main/index.js","preload/index.cjs","renderer/index.html"]){mkdirSync("out/"+f.split("/")[0],{recursive:true});writeFileSync("out/"+f,"rebuilt "+f);}',
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
      yield* fs.writeFileString(path.join(source, "old.zip"), "authored-built-package");
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
        artifactRelativePath: "old.zip",
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
        Layer.provide(
          Layer.succeed(Packaging.CompatibilityPackaging, {
            package: (source, identity) =>
              Effect.tryPromise({
                try: () => packageMacos(f.config, source, identity),
                catch: (cause) => new Packaging.PackagingError({ cause }),
              }),
          }),
        ),
        Layer.provide(Runner.layerUnconfiguredChecks),
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
        expect(result, stableStringify(result)).toMatchObject({ state: "requires-validation" });
        expect(
          result.checks.filter((check) => check.outcome === "passed").map((check) => check.kind),
        ).toEqual(["source", "patches", "build"]);
        expect(yield* fs.readFileString(path.join(source, "source.txt"))).toBe("after\n");
        expect(result.identity.artifactSha256).not.toBe(input.identity.artifactSha256);
        expect(result.artifactPath).not.toBe(path.join(source, input.artifactRelativePath));
        expect(
          (yield* runner.run({ ...input, identity: result.identity }).pipe(Effect.flip)).reason,
        ).toBe("identity");
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
        ).toBe("identity");
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

it("rejects a hash-matching base with wrong package metadata and unsupported platforms", async () => {
  await using f = await fixture("9.0.0");
  await expect(packageMacos(f.config, f.source, identity)).rejects.toThrow(
    "Wrong pinned package metadata",
  );
  expect(await NodeFSP.readdir(f.config.outputDirectory)).toEqual([]);
  await expect(
    packageMacos({ ...f.config, platform: "win32" }, f.source, identity),
  ).rejects.toThrow("Only macOS");
});
});
