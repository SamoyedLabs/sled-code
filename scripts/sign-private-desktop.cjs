#!/usr/bin/env node
// Sign the complete private Electron artifact with the same local identity as its helper.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const identity = process.env.T3_REMOTE_SIGNING_IDENTITY;
if (!identity || identity === "-")
  throw new Error("Set T3_REMOTE_SIGNING_IDENTITY to your Apple development identity.");
const archive = path.resolve(process.argv[2]);
if (!archive.endsWith(".zip")) throw new Error("Expected the private desktop ZIP.");
const store = path.join(root, "node_modules/.pnpm");
const builders = fs.readdirSync(store).filter((name) => name.startsWith("app-builder-lib@"));
if (builders.length !== 1)
  throw new Error(
    "Expected the pinned electron-builder dependencies; install the upstream workspace.",
  );
const builderRequire = require("node:module").createRequire(
  path.join(store, builders[0], "node_modules/app-builder-lib/package.json"),
);
const { signAsync } = builderRequire("@electron/osx-sign");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "t3-private-sign-"));
const output = `${archive}.signed.zip`;
(async () => {
  try {
    execFileSync("/usr/bin/ditto", ["-x", "-k", archive, temporary]);
    const apps = fs.readdirSync(temporary).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error("Expected one desktop app in the ZIP.");
    const app = path.join(temporary, apps[0]);
    await signAsync({
      app,
      identity,
      platform: "darwin",
      type: "development",
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ hardenedRuntime: true, timestamp: "none" }),
    });
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, output]);
    fs.renameSync(output, archive);
    console.log(
      "PASS: complete private desktop signed and verified; public distribution still requires Developer ID and notarization.",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(output, { force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
