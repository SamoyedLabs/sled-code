// @effect-diagnostics nodeBuiltinImport:off -- Local packaging and fixtures use Node file and subprocess APIs.
import * as NodeUtil from "node:util";
import * as NodeChildProcess from "node:child_process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { OpenbotCompatibilityIdentity } from "@t3tools/contracts";

export class PackagingError extends Schema.TaggedError<PackagingError>()("OpenbotPackagingError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Trusted packaging failed: ${this.cause instanceof Error ? this.cause.message : "unknown packaging error"}`;
  }
}
const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const sha = (bytes: Uint8Array | string) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");

// Pins are application composition, never preparation-thread input.
export interface PackagingConfig {
  readonly platform: string;
  readonly baseArchive: string;
  readonly baseSha256: string;
  readonly asarCli: string;
  readonly outputDirectory: string;
}
export interface PackagedCandidate {
  readonly artifactPath: string;
  readonly identity: OpenbotCompatibilityIdentity;
  readonly buildSha256: string;
  readonly baseSha256: string;
  readonly verify: () => Promise<void>;
}
export class CompatibilityPackaging extends Context.Service<
  CompatibilityPackaging,
  {
    readonly package: (
      sourceDirectory: string,
      identity: OpenbotCompatibilityIdentity,
    ) => Effect.Effect<PackagedCandidate, PackagingError>;
  }
>()("t3/openbot/CompatibilityPackaging") {}

async function tree(root: string, bundle = false): Promise<string> {
  const entries: Array<readonly [string, string, number]> = [];
  async function visit(relative: string): Promise<void> {
    const file = NodePath.join(root, relative),
      stat = await NodeFSP.lstat(file);
    if (stat.isSymbolicLink()) {
      const target = await NodeFSP.readlink(file);
      if (
        !bundle ||
        !NodePath.resolve(NodePath.dirname(file), target).startsWith(root + NodePath.sep)
      )
        throw new Error("Payload symlink rejected");
      entries.push([relative, `link:${target}`, stat.mode & 0o777]);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of (await NodeFSP.readdir(file)).sort())
        await visit(NodePath.join(relative, name));
    } else if (stat.isFile())
      entries.push([relative, sha(await NodeFSP.readFile(file)), stat.mode & 0o777]);
    else throw new Error("Non-file payload rejected");
  }
  await visit("");
  if (entries.length === 0) throw new Error("Empty payload");
  return sha(JSON.stringify(entries));
}
async function same(actual: string, expected: string): Promise<void> {
  if (actual !== expected) throw new Error("Packaging identity mismatch");
}

export async function packageMacos(
  config: PackagingConfig,
  source: string,
  requested: OpenbotCompatibilityIdentity,
): Promise<PackagedCandidate> {
  if (config.platform !== "darwin") throw new Error("Only macOS packaging is implemented");
  const out = NodePath.join(source, "out");
  const buildSha256 = await tree(out);
  await NodeFSP.access(NodePath.join(out, "main/index.js"));
  await NodeFSP.access(NodePath.join(out, "preload/index.cjs"));
  await NodeFSP.access(NodePath.join(out, "renderer/index.html"));
  await same(sha(await NodeFSP.readFile(config.baseArchive)), config.baseSha256);
  await NodeFSP.mkdir(config.outputDirectory, { recursive: true, mode: 0o700 });
  const attempt = await NodeFSP.mkdtemp(NodePath.join(config.outputDirectory, "package-"));
  const command = async (file: string, args: string[]) => {
    const { stdout } = await exec(file, args, {
      cwd: attempt,
      env: { PATH: "/usr/bin:/bin", HOME: attempt },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 900_000,
    });
    return stdout.trim();
  };
  const asar = (...args: string[]) => command(process.execPath, [config.asarCli, ...args]);
  try {
    // Extract a hash-verified release, never the mutable extracted runtime app.
    const archive = NodePath.join(attempt, "base.zip");
    await NodeFSP.copyFile(config.baseArchive, archive);
    await same(sha(await NodeFSP.readFile(archive)), config.baseSha256);
    const base = NodePath.join(attempt, "base");
    await command("/usr/bin/ditto", ["-x", "-k", archive, base]);
    const app = NodePath.join(base, "OpenBot.app");
    const resources = NodePath.join(app, "Contents/Resources");
    const appAsar = NodePath.join(resources, "app.asar");
    const payload = NodePath.join(attempt, "payload");
    await asar("extract", appAsar, payload);
    const metadata = JSON.parse(
      await NodeFSP.readFile(NodePath.join(payload, "package.json"), "utf8"),
    );
    if (
      metadata.name !== "openbot" ||
      metadata.version !== "0.60.0" ||
      metadata.main !== "./out/main/index.js"
    )
      throw new Error("Wrong pinned package metadata");
    const dependencies = await tree(NodePath.join(payload, "node_modules"));
    await NodeFSP.rm(NodePath.join(payload, "out"), { recursive: true, force: true });
    await NodeFSP.cp(out, NodePath.join(payload, "out"), { recursive: true });
    await same(await tree(NodePath.join(payload, "out")), buildSha256);
    const payloadSha256 = await tree(payload);
    await NodeFSP.rm(appAsar);
    await NodeFSP.rm(`${appAsar}.unpacked`, { recursive: true, force: true });
    await asar("pack", payload, appAsar, "--unpack", "**/*");
    const packed = await NodeFSP.readFile(appAsar);
    const headerSize = packed.readUInt32LE(12);
    if (headerSize <= 0 || headerSize > packed.length - 16) throw new Error("Invalid ASAR header");
    const headerSha256 = sha(packed.subarray(16, 16 + headerSize));
    const plist = NodePath.join(app, "Contents/Info.plist");
    await command("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerSha256}`,
      plist,
    ]);
    await same(
      await command("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :ElectronAsarIntegrity:Resources/app.asar:hash",
        plist,
      ]),
      headerSha256,
    );
    await same(
      await command("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :ElectronAsarIntegrity:Resources/app.asar:algorithm",
        plist,
      ]),
      "SHA256",
    );
    // Sled starts this bundle as a local-server child; suppress its Dock tile before Electron boots.
    await command("/usr/bin/plutil", ["-replace", "LSUIElement", "-bool", "true", plist]);
    await command("/usr/bin/codesign", ["--force", "--sign", "-", app]);
    await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    const bundleSha256 = await tree(app, true);
    const artifactPath = NodePath.join(attempt, "OpenBot.zip");
    await command("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      app,
      artifactPath,
    ]);
    const unpacked = NodePath.join(attempt, "verify");
    await command("/usr/bin/ditto", ["-x", "-k", artifactPath, unpacked]);
    const archivedApp = NodePath.join(unpacked, "OpenBot.app");
    await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", archivedApp]);
    await same(await tree(archivedApp, true), bundleSha256);
    const extracted = NodePath.join(attempt, "verified-payload");
    await asar("extract", NodePath.join(archivedApp, "Contents/Resources/app.asar"), extracted);
    await same(await tree(extracted), payloadSha256);
    await same(await tree(NodePath.join(extracted, "out")), buildSha256);
    await same(await tree(NodePath.join(extracted, "node_modules")), dependencies);
    const identity = Object.freeze({
      ...requested,
      artifactSha256: sha(await NodeFSP.readFile(artifactPath)),
    });
    const manifest = {
      identity,
      buildSha256,
      baseSha256: config.baseSha256,
      payloadSha256,
      headerSha256,
      bundleSha256,
    };
    const manifestPath = NodePath.join(attempt, "provenance.json");
    const manifestBytes = JSON.stringify(manifest);
    await NodeFSP.writeFile(manifestPath, manifestBytes, { flag: "wx", mode: 0o600 });
    const verify = async () => {
      await same(await tree(out), buildSha256);
      await same(sha(await NodeFSP.readFile(artifactPath)), identity.artifactSha256);
      await same(await NodeFSP.readFile(manifestPath, "utf8"), manifestBytes);
      await same(sha(await NodeFSP.readFile(config.baseArchive)), config.baseSha256);
    };
    await verify();
    for (const entry of ["base.zip", "base", "payload", "verify", "verified-payload"])
      await NodeFSP.rm(NodePath.join(attempt, entry), { recursive: true, force: true });
    return { artifactPath, identity, buildSha256, baseSha256: config.baseSha256, verify };
  } catch (error) {
    await NodeFSP.rm(attempt, { recursive: true, force: true });
    throw error;
  }
}

export const layer = (config: Omit<PackagingConfig, "baseSha256" | "platform">) =>
  Layer.effect(
    CompatibilityPackaging,
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      return CompatibilityPackaging.of({
        package: Effect.fn("CompatibilityPackaging.package")(
          (source: string, identity: OpenbotCompatibilityIdentity) =>
            Effect.tryPromise({
              try: () =>
                packageMacos(
                  {
                    ...config,
                    platform,
                    baseSha256: "7537c3f3d7364bef996eb458837d203cd1835dbbf52a9355da815e219dbb31f7",
                  },
                  source,
                  identity,
                ),
              catch: (cause) => new PackagingError({ cause }),
            }),
        ),
      });
    }),
  );
