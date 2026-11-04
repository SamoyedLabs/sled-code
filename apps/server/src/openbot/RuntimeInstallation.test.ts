// @effect-diagnostics nodeBuiltinImport:off -- Concrete ZIP and filesystem fixtures exercise executable installation.
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as RuntimeInstallation from "./RuntimeInstallation.ts";
import * as Integration from "./Integration.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";
import type { OpenbotStagedRuntime } from "@t3tools/contracts";

const executable = "OpenBot.app/Contents/MacOS/OpenBot";
const zip = (entries: ReadonlyArray<{ name: string; data: string; mode?: number }>) => {
  const records: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = Buffer.from(entry.data);
    const checksum = NodeZlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100755) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    records.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, central, end]);
};

const fixture = Effect.fn("test.runtimeInstallFixture")(function* (
  entries = [
    { name: executable, data: "#!/bin/sh\nexit 0\n", mode: 0o100755 },
    {
      name: "OpenBot.app/Contents/Frameworks/Actual/library",
      data: "framework bytes",
      mode: 0o100644,
    },
    { name: "OpenBot.app/Contents/Frameworks/Current", data: "Actual", mode: 0o120777 },
  ],
  version = "v0.60.0",
  existingDirectory?: string,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const stateDirectory =
    existingDirectory ?? (yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-install-" }));
  const bytes = zip(entries),
    sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  const name = `OpenBot-${version.slice(1)}-arm64.zip`;
  const directory = path.join(stateDirectory, "openbot", "upstream", "artifacts", version, sha256);
  yield* fs.makeDirectory(directory, { recursive: true });
  const artifactPath = path.join(directory, name);
  yield* fs.writeFile(artifactPath, bytes);
  const staged: OpenbotStagedRuntime = {
    name,
    sha256,
    size: bytes.length,
    artifactPath,
    version,
    platform: "darwin-arm64",
    releaseCommit: "0c7753fa622c38419939cd230657f40e5883d098",
    compatibility: "pinned-baseline",
    activation: "blocked",
    stagedAt: "2026-11-04T00:00:00Z",
  };
  return { fs, path, stateDirectory, staged, layer: RuntimeInstallation.layer({ stateDirectory }) };
});

it.effect(
  "installs a verified app with internal framework links and restores its selected runtime after restart",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const installed = yield* Effect.gen(function* () {
        const service = yield* RuntimeInstallation.RuntimeInstallation;
        const installed = yield* service.install(f.staged);
        expect(yield* f.fs.readFileString(installed.executablePath)).toBe("#!/bin/sh\nexit 0\n");
        const root = f.path.resolve(installed.executablePath, "../../..");
        expect(
          yield* f.fs.readFileString(f.path.join(root, "Contents/Frameworks/Current/library")),
        ).toBe("framework bytes");
        yield* service.select(installed);
        return installed;
      }).pipe(Effect.provide(f.layer));
      yield* Effect.gen(function* () {
        const service = yield* RuntimeInstallation.RuntimeInstallation;
        expect((yield* service.getStatus).active).toEqual(installed);
        expect(yield* service.resolve({ version: "v0.60.0", platform: "darwin-arm64" })).toEqual(
          installed,
        );
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([
  { name: "traversal", entries: [{ name: "../escaped", data: "outside", mode: 0o100755 }] },
  {
    name: "escaping symlink",
    entries: [{ name: executable, data: "../../../../outside", mode: 0o120777 }],
  },
  {
    name: "duplicate file",
    entries: [
      { name: executable, data: "one", mode: 0o100755 },
      { name: executable, data: "two", mode: 0o100755 },
    ],
  },
  {
    name: "missing executable",
    entries: [{ name: "OpenBot.app/Contents/Info.plist", data: "plist", mode: 0o100644 }],
  },
])("rejects $name without publishing an installed runtime", ({ entries }) =>
  Effect.gen(function* () {
    const f = yield* fixture(entries);
    yield* Effect.gen(function* () {
      const installer = yield* RuntimeInstallation.RuntimeInstallation;
      expect((yield* Effect.flip(installer.install(f.staged))).reason).toBe("archive");
      expect(yield* installer.getStatus).toEqual({ installed: [], active: null, previous: null });
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a staged artifact that changed after verification", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fs.writeFileString(f.staged.artifactPath, "modified archive");
    yield* Effect.gen(function* () {
      const installer = yield* RuntimeInstallation.RuntimeInstallation;
      expect((yield* Effect.flip(installer.install(f.staged))).reason).toBe("integrity");
      expect((yield* installer.getStatus).installed).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const hostScript = (port: number) => `#!${process.execPath}
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdout.write("OPENBOT_LOCAL_SERVER_READY " + JSON.stringify({serverId:"fixture-"+process.pid,serverName:"Bots",apiUrl:"http://127.0.0.1:${port}",fingerprint:"fixture",publicKey:"fixture",ownerMemberId:"owner"})+"\\n");
`;

it.live(
  "activates only after Team readiness, restores prior selection on failed validation or manifest write, and rolls back",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture([{ name: executable, data: hostScript(9090), mode: 0o100755 }]);
      const candidate = yield* fixture(
        [{ name: executable, data: hostScript(9091), mode: 0o100755 }],
        "v0.60.1",
        f.stateDirectory,
      );
      let rejectCandidate = false,
        failSelection = false,
        closed = 0;
      const fileSystem: FileSystem.FileSystem = {
        ...f.fs,
        rename: (from, to) =>
          failSelection && to.endsWith("installation.json")
            ? Effect.fail(
                PlatformError.badArgument({
                  module: "FileSystem",
                  method: "rename",
                  description: "fixture selection write failure",
                }),
              )
            : f.fs.rename(from, to),
      };
      yield* Effect.gen(function* () {
        const installer = yield* RuntimeInstallation.RuntimeInstallation;
        const first = yield* installer.install(f.staged);
        yield* installer.install(candidate.staged);
        yield* Effect.gen(function* () {
          const service = yield* Integration.Integration;
          expect((yield* service.activateRuntime(f.staged)).state).toBe("ready");
          rejectCandidate = true;
          yield* service.activateRuntime(candidate.staged).pipe(Effect.flip);
          expect((yield* installer.getStatus).active).toEqual(first);
          expect((yield* service.status).state).toBe("ready");
          yield* service.listAgents;
          rejectCandidate = false;
          failSelection = true;
          yield* service.activateRuntime(candidate.staged).pipe(Effect.flip);
          expect((yield* installer.getStatus).active).toEqual(first);
          expect((yield* service.status).state).toBe("ready");
          failSelection = false;
          yield* service.activateRuntime(candidate.staged);
          expect((yield* installer.getStatus).active?.version).toBe("v0.60.1");
          expect((yield* installer.getStatus).previous).toEqual(first);
          yield* service.rollbackRuntime;
          expect((yield* installer.getStatus).active).toEqual(first);
          expect(closed).toBeGreaterThanOrEqual(3);
          yield* service.stop;
        }).pipe(
          Effect.provide(
            Integration.layerWithHost("fixture-secret").pipe(
              Layer.provide(Layer.succeed(RuntimeInstallation.RuntimeInstallation, installer)),
              Layer.provide(
                ManagedHost.layer({
                  allowExecutableSwitch: true,
                  userDataDirectory: f.path.join(f.stateDirectory, "profile"),
                  agentRoot: f.path.join(f.stateDirectory, "agents"),
                  ownerSecret: "fixture-secret",
                  serverName: "Bots",
                  startupTimeoutMs: 5000,
                }),
              ),
              Layer.provide(
                Layer.succeed(TeamClient.TeamClient, {
                  connect: ({ apiUrl }) =>
                    Effect.succeed({
                      events: Stream.never,
                      files: {
                        listWorkspace: () => Effect.die("unused file protocol"),
                        search: () => Effect.die("unused file protocol"),
                        attachment: () => Effect.die("unused file protocol"),
                        sentAttachments: () => Effect.die("unused file protocol"),
                        download: () => Effect.die("unused file protocol"),
                        upload: () => Effect.die("unused file protocol"),
                        send: () => Effect.die("unused file protocol"),
                        discard: () => Effect.die("unused file protocol"),
                      },
                      apiRead: () => Effect.succeed(null),
                      apiWrite: () => Effect.succeed(null),
                      apiAdmin: () => Effect.succeed(null),
                      listAgents: Effect.suspend(() =>
                        rejectCandidate && apiUrl.endsWith(":9091")
                          ? Effect.fail(new TeamClient.TeamClientError({ reason: "decode" }))
                          : Effect.succeed([]),
                      ),
                      close: Effect.sync(() => {
                        closed++;
                      }),
                    }),
                }),
              ),
            ),
          ),
        );
      }).pipe(
        Effect.provide(f.layer),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Architecture, "arm64"),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
