#!/usr/bin/env node
// Verify the frozen bytes that the hosted publisher will upload.
const fs = require("node:fs");
const NodeProcess = require("node:process");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const desktopRequire = createRequire(path.resolve("apps/desktop/package.json"));
const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
const libRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
const yaml = libRequire("js-yaml");
const asar = libRequire("@electron/asar");
const { buildBlockMap } = libRequire("./out/targets/blockmap/blockmap.js");
const assert = require("node:assert/strict");
const hash = (file, algorithm = "sha256", format = "hex") =>
  crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(format);
const run = (command, args) => cp.execFileSync(command, args, { encoding: "utf8" });
const find = (folder, name) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.name === name) return file;
    if (entry.isDirectory()) {
      const found = find(file, name);
      if (found) return found;
    }
  }
};
const [platform, input] = process.argv.slice(2);
const folder = path.resolve(input);
const version = process.env.SLED_RELEASE_VERSION;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sled-cloud-verify-"));
async function main() {
  try {
    assert(["mac", "win"].includes(platform));
    const manifestName = platform === "mac" ? "latest-mac.yml" : "latest.yml";
    const manifest = yaml.load(fs.readFileSync(path.join(folder, manifestName), "utf8"));
    assert.equal(manifest.version, version);
    assert.equal(manifest.files.length, 1);
    const entry = manifest.files[0];
    assert.equal(path.basename(entry.url), entry.url);
    const artifact = path.join(folder, entry.url);
    if (
      platform === "mac" &&
      (process.env.SLED_MAC_DISTRIBUTION || "private-development") === "private-development"
    ) {
      await buildBlockMap(artifact, "gzip", artifact + ".blockmap");
      entry.sha512 = hash(artifact, "sha512", "base64");
      entry.size = fs.statSync(artifact).size;
      manifest.sha512 = entry.sha512;
      fs.writeFileSync(path.join(folder, manifestName), yaml.dump(manifest));
    }
    assert.equal(hash(artifact, "sha512", "base64"), entry.sha512);
    assert.equal(fs.statSync(artifact).size, entry.size);
    assert.equal(manifest.sha512, entry.sha512);
    let resources;
    if (platform === "mac") {
      assert.equal(NodeProcess.platform, "darwin");
      assert(artifact.endsWith("-arm64.zip"));
      run("/usr/bin/ditto", ["-x", "-k", artifact, temporary]);
      const apps = fs.readdirSync(temporary).filter((name) => name.endsWith(".app"));
      assert.equal(apps.length, 1);
      const app = path.join(temporary, apps[0]);
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", app]);
      const signature = cp.spawnSync("/usr/bin/codesign", ["-dvvv", app], { encoding: "utf8" });
      assert.equal(signature.status, 0);
      const privateMac =
        (process.env.SLED_MAC_DISTRIBUTION || "private-development") === "private-development";
      assert(
        signature.stderr.includes(
          privateMac ? "Authority=Apple Development:" : "Authority=Developer ID Application:",
        ),
      );
      assert(
        signature.stderr.split("\n").includes("TeamIdentifier=" + process.env.SLED_APPLE_TEAM_ID),
      );
      if (privateMac) {
        assert(
          process.env.SLED_MAC_SIGNING_REQUIREMENT,
          "Require the prior signed app's exact designated requirement",
        );
        run("/usr/bin/codesign", [
          "--verify",
          "--deep",
          "--strict",
          "--all-architectures",
          "-R",
          "=" + process.env.SLED_MAC_SIGNING_REQUIREMENT,
          app,
        ]);
      } else {
        run("xcrun", ["stapler", "validate", app]);
        run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
      }
      run("node", ["scripts/verify-desktop-package.cjs", artifact]);
      resources = path.join(app, "Contents/Resources");
    } else {
      assert.equal(NodeProcess.platform, "win32");
      assert(artifact.endsWith("-x64.exe"));
      run("7z", ["x", "-y", "-o" + temporary, artifact]);
      const inner = find(temporary, "app-64.7z");
      assert(inner, "Expected x64 NSIS application payload");
      const payload = path.join(temporary, "payload");
      run("7z", ["x", "-y", "-o" + payload, inner]);
      const executable = find(payload, "Sled Code.exe");
      assert(executable, "Expected private Sled executable");
      for (const file of [artifact, executable]) {
        const result = cp.execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            '$s=Get-AuthenticodeSignature -LiteralPath $env:SLED_VERIFY_FILE; if($s.Status -ne "Valid") {throw "Invalid Authenticode signature"}; if($s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -cne $env:SLED_WINDOWS_PUBLISHER_NAME) {throw "Unexpected Authenticode publisher"}; if($env:SLED_WINDOWS_SIGNER_THUMBPRINT -and $s.SignerCertificate.Thumbprint -ine $env:SLED_WINDOWS_SIGNER_THUMBPRINT) {throw "Unexpected Authenticode certificate"}',
          ],
          { env: { ...process.env, SLED_VERIFY_FILE: file }, encoding: "utf8" },
        );
        assert.equal(result.trim(), "");
      }
      resources = path.join(path.dirname(executable), "resources");
    }
    const packaged = JSON.parse(asar.extractFile(path.join(resources, "app.asar"), "package.json"));
    assert.equal(packaged.version, version);
    assert.equal(packaged.sledPrivateEnvironment.SLED_PORTABLE_PROFILE, "true");
    assert.equal(packaged.sledPrivateEnvironment.T3CODE_DISABLE_AUTO_UPDATE, "false");
    assert.equal(packaged.sledPrivateEnvironment.T3CODE_HOME, undefined);
    const feed = yaml.load(fs.readFileSync(path.join(resources, "app-update.yml"), "utf8"));
    assert.equal(feed.provider, "github");
    assert.equal(feed.owner, "SamoyedLabs");
    assert.equal(feed.repo, "sled-code");
    assert.equal(feed.token, undefined);
    assert.equal(feed.private, undefined);
    if (platform === "win")
      assert.deepEqual(feed.publisherName, [process.env.SLED_WINDOWS_PUBLISHER_NAME]);
    const names = [entry.url, entry.url + ".blockmap", manifestName];
    // NSIS may embed its blockmap. Never append bytes to an Authenticode-signed EXE.
    if (platform === "win" && !fs.existsSync(path.join(folder, entry.url + ".blockmap")))
      names.splice(1, 1);
    fs.writeFileSync(
      path.join(folder, `verified-${platform}.json`),
      JSON.stringify(
        {
          version,
          platform,
          hashes: Object.fromEntries(names.map((name) => [name, hash(path.join(folder, name))])),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log("PASS: final hosted " + platform + " signatures and update assets verified");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
