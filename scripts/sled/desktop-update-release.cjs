#!/usr/bin/env node
// Metadata is generated only after final signing; publishing never replaces existing assets.
const fs = require("node:fs");
const NodeProcess = require("node:process");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
const libRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
const { buildBlockMap } = libRequire("./out/targets/blockmap/blockmap.js");
const yaml = libRequire("js-yaml");
const asar = libRequire("@electron/asar");
const semver = libRequire("semver");
const REPO = "SamoyedLabs/sled-code";
const run = (cmd, args) =>
  cp.execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const hash = (file, algorithm = "sha256", encoding = "hex") =>
  crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
function verifyDirectory(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "release.json")));
  if (
    manifest.repository !== REPO ||
    !semver.valid(manifest.version) ||
    semver.prerelease(manifest.version)
  )
    throw Error("Expected a stable Sled release");
  const names = Object.keys(manifest.hashes);
  if (names.length !== 3 || names.some((name) => path.basename(name) !== name))
    throw Error("Invalid asset set");
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    if (hash(path.join(directory, name)) !== expected)
      throw Error(`Changed release asset: ${name}`);
  }
  const info = yaml.load(fs.readFileSync(path.join(directory, "latest-mac.yml"), "utf8"));
  const file = info.files[0];
  if (
    info.version !== manifest.version ||
    info.files.length !== 1 ||
    !names.includes(file.url) ||
    file.sha512 !== hash(path.join(directory, file.url), "sha512", "base64") ||
    file.size !== fs.statSync(path.join(directory, file.url)).size
  )
    throw Error("Final updater metadata mismatch");
  return manifest;
}
async function prepare(archive, baseline, output) {
  if (NodeProcess.platform !== "darwin")
    throw Error("macOS verification required; Windows NSIS certification must run on Windows");
  if (!baseline.endsWith(".app"))
    throw Error("Supply the prior verified private .app as signature baseline");
  if (fs.existsSync(output)) throw Error("Output already exists; releases are immutable");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", baseline]);
  const requirement = cp
    .execFileSync("/usr/bin/codesign", ["-d", "-r-", baseline], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    .trim();
  if (!requirement.startsWith("designated => "))
    throw Error("Missing designated signature requirement");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sled-feed-"));
  try {
    run("/usr/bin/ditto", ["-x", "-k", archive, temporary]);
    const apps = fs.readdirSync(temporary).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw Error("Expected one application");
    const app = path.join(temporary, apps[0]);
    const info = JSON.parse(
      run("/usr/bin/plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        path.join(app, "Contents/Info.plist"),
      ]),
    );
    const version = info.CFBundleShortVersionString;
    if (!semver.valid(version) || semver.prerelease(version))
      throw Error("Use a stable Sled semver for latest channel discovery");
    if (
      info.CFBundleIdentifier !== "com.t3tools.t3code.remote-dev" ||
      info.LSEnvironment?.SLED_PORTABLE_PROFILE !== "true" ||
      info.LSEnvironment?.T3CODE_DISABLE_AUTO_UPDATE !== "false" ||
      info.LSEnvironment?.T3CODE_HOME
    )
      throw Error("Expected portable private Sled updater opt-in");
    const resources = path.join(app, "Contents/Resources");
    const feed = yaml.load(fs.readFileSync(path.join(resources, "app-update.yml"), "utf8"));
    if (
      feed.provider !== "github" ||
      feed.owner !== "SamoyedLabs" ||
      feed.repo !== "sled-code" ||
      feed.private
    )
      throw Error("Expected public Sled-owned feed without embedded credentials");
    const packageVersion = JSON.parse(
      asar.extractFile(path.join(resources, "app.asar"), "package.json"),
    ).version;
    if (packageVersion !== version) throw Error("Bundle/package versions differ");
    run("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--all-architectures",
      "-R",
      "=" + requirement.slice("designated => ".length),
      app,
    ]);
    const arch = run("/usr/bin/lipo", [
      "-archs",
      path.join(app, "Contents/MacOS", info.CFBundleExecutable),
    ]).trim();
    if (!["arm64", "x86_64"].includes(arch))
      throw Error("Expected a single verified Mac architecture");
    fs.mkdirSync(output, { recursive: true });
    const filename = `Sled-Code-${version}-${arch === "x86_64" ? "x64" : arch}.zip`;
    const destination = path.join(output, filename);
    fs.copyFileSync(archive, destination, fs.constants.COPYFILE_EXCL);
    await buildBlockMap(destination, "gzip", destination + ".blockmap");
    const file = {
      url: filename,
      sha512: hash(destination, "sha512", "base64"),
      size: fs.statSync(destination).size,
    };
    fs.writeFileSync(
      path.join(output, "latest-mac.yml"),
      yaml.dump({
        version,
        files: [file],
        path: filename,
        sha512: file.sha512,
        releaseDate: new Date().toISOString(),
      }),
      { flag: "wx" },
    );
    const names = [filename, filename + ".blockmap", "latest-mac.yml"];
    fs.writeFileSync(
      path.join(output, "release.json"),
      JSON.stringify(
        {
          schema: 1,
          repository: REPO,
          version,
          platform: `mac-${arch}`,
          signatureRequirement: requirement,
          distribution: "same-owner Apple Development; not notarized",
          hashes: Object.fromEntries(names.map((name) => [name, hash(path.join(output, name))])),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    return verifyDirectory(output);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "prepare" && args.length === 3)
    return prepare(...args.map((value) => path.resolve(value)));
  if (action === "verify" && args.length === 1) return verifyDirectory(path.resolve(args[0]));
  if (
    ["publish", "draft"].includes(action) &&
    args.length === 2 &&
    args[1] === "--confirm-sled-release"
  ) {
    const directory = path.resolve(args[0]);
    const manifest = verifyDirectory(directory);
    const tag = `v${manifest.version}`;
    // A fresh release/tag only. A partial upload stays draft and is never exposed to clients.
    const existing = cp.spawnSync("gh", ["api", `repos/${REPO}/git/ref/tags/${tag}`], {
      encoding: "utf8",
    });
    if (existing.status === 0 || !existing.stderr.includes("404"))
      throw Error("Tag exists or GitHub access cannot be verified");
    if (run("git", ["status", "--porcelain"]).trim())
      throw Error("Commit the release source before publishing; working tree is dirty");
    const head = run("git", ["rev-parse", "HEAD"]).trim();
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      REPO,
      "--target",
      head,
      "--draft",
      "--title",
      `Sled Code ${manifest.version}`,
      "--notes",
      "Private same-owner desktop release. macOS Apple Development signed; not notarized.",
    ]);
    run("gh", [
      "release",
      "upload",
      tag,
      "--repo",
      REPO,
      ...Object.keys(manifest.hashes).map((name) => path.join(directory, name)),
      path.join(directory, "release.json"),
    ]);
    const uploaded = JSON.parse(run("gh", ["api", `repos/${REPO}/releases/tags/${tag}`]));
    for (const name of [...Object.keys(manifest.hashes), "release.json"]) {
      const asset = uploaded.assets.find((asset) => asset.name === name);
      if (
        !asset ||
        asset.size !== fs.statSync(path.join(directory, name)).size ||
        asset.digest !== `sha256:${hash(path.join(directory, name))}`
      )
        throw Error(`GitHub digest mismatch: ${name}; release retained as draft`);
    }
    if (action === "publish")
      run("gh", [
        "release",
        "edit",
        tag,
        "--repo",
        REPO,
        "--draft=false",
        "--prerelease=false",
        "--latest",
      ]);
    return {
      state: action === "publish" ? "published" : "draft",
      published: `https://github.com/${REPO}/releases/tag/${tag}`,
      ...manifest,
    };
  }
  throw Error(
    "Usage: prepare <final-signed.zip> <prior-private.app> <new-output-dir> | verify <dir> | publish|draft <dir> --confirm-sled-release",
  );
}
if (require.main === module)
  main()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { verifyDirectory };
