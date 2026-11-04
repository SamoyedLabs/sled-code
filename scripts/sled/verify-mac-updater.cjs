#!/usr/bin/env node
// Run only a disposable Electron harness; never launches the Sled host or installs an update.
const fs = require("node:fs");
const NodeProcess = require("node:process");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const cp = require("node:child_process");
const { createRequire } = require("node:module");
const { verifyDirectory } = require("./desktop-update-release.cjs");
const root = path.resolve(__dirname, "../..");
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
async function main() {
  const directory = path.resolve(process.argv[2]);
  const manifest = verifyDirectory(directory);
  const identity = process.env.T3_REMOTE_SIGNING_IDENTITY;
  if (NodeProcess.platform !== "darwin" || !identity || identity === "-")
    throw Error("Requires macOS and an authorized real signing identity");
  const nativeCache = path.join(
    os.homedir(),
    "Library/Caches/com.t3tools.t3code.remote-dev.ShipIt",
  );
  if (fs.existsSync(nativeCache))
    throw Error("Native Sled updater cache exists; refuse to interfere with a real installation");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sled-native-update-"));
  const app = path.join(temporary, "Sled Updater Test.app");
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1);
    const file = path.join(directory, name);
    if (!Object.hasOwn(manifest.hashes, name)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    cp.execFileSync("/usr/bin/ditto", [
      path.join(path.dirname(desktopRequire.resolve("electron/package.json")), "dist/Electron.app"),
      app,
    ]);
    fs.renameSync(
      path.join(app, "Contents/MacOS/Electron"),
      path.join(app, "Contents/MacOS/SledUpdaterTest"),
    );
    const plist = path.join(app, "Contents/Info.plist");
    cp.execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :CFBundleExecutable SledUpdaterTest",
      plist,
    ]);
    cp.execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :CFBundleIdentifier com.t3tools.t3code.remote-dev",
      plist,
    ]);
    cp.execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :CFBundleShortVersionString 0.1.6",
      plist,
    ]);
    cp.execFileSync("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleVersion 0.1.6", plist]);
    const resources = path.join(app, "Contents/Resources");
    const code = path.join(resources, "app");
    fs.mkdirSync(code);
    fs.writeFileSync(
      path.join(code, "package.json"),
      JSON.stringify({ name: "sled-updater-test", version: "0.1.6", main: "main.cjs" }),
    );
    const result = path.join(temporary, "result.json");
    fs.writeFileSync(
      path.join(code, "main.cjs"),
      `
const {app, autoUpdater:nativeUpdater} = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(path.join(temporary, "userdata"))});
app.whenReady().then(async () => {
 const {autoUpdater} = require(${JSON.stringify(desktopRequire.resolve("electron-updater"))});
 autoUpdater.logger = console;
 autoUpdater.autoDownload = false;
 autoUpdater.autoInstallOnAppQuit = false;
 autoUpdater.disableDifferentialDownload = true;
 autoUpdater.setFeedURL({provider:'generic',url:'http://127.0.0.1:${server.address().port}'});
 autoUpdater.on('error', error => { fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({error:error.message})); app.exit(1); });
 nativeUpdater.on('error', error => { fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({error:error.message})); app.exit(1); });
 autoUpdater.on('update-downloaded', () => nativeUpdater.checkForUpdates());
 nativeUpdater.on('update-downloaded', () => { fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({nativeUpdateDownloaded:true,version:${JSON.stringify(manifest.version)}})); app.exit(0); });
 try { await autoUpdater.checkForUpdates(); await autoUpdater.downloadUpdate(); }
 catch(error) { fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({error:error.message})); app.exit(1); }
});`,
    );
    fs.writeFileSync(
      path.join(resources, "app-update.yml"),
      "provider: generic\nurl: http://127.0.0.1:" +
        server.address().port +
        "\nupdaterCacheDirName: sled-disposable-update-test\n",
    );
    const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
    const libRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
    const { signAsync } = libRequire("@electron/osx-sign");
    await signAsync({
      app,
      identity,
      platform: "darwin",
      type: "development",
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ hardenedRuntime: true, timestamp: "none" }),
    });
    const log = fs.openSync(path.join(root, ".tools/sled-native-update-test.log"), "w");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = cp.spawn(path.join(app, "Contents/MacOS/SledUpdaterTest"), [], {
        env,
        stdio: ["ignore", log, log],
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(Error("Native updater harness timed out"));
      }, 90000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Error("Native updater harness failed; see .tools/sled-native-update-test.log"));
      });
    });
    const evidence = JSON.parse(fs.readFileSync(result));
    if (!evidence.nativeUpdateDownloaded || evidence.version !== manifest.version)
      throw Error("Native updater did not validate the target");
    fs.writeFileSync(
      path.join(root, ".tools/sled-native-update-evidence.json"),
      JSON.stringify({ ...evidence, release: manifest.hashes, installed: false }, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } finally {
    server.close();
    // ShipIt records launchAfterInstallation=false; retain its disposable target for inspection.
    // No live installation or Sled profile is used by the harness.
    console.log("Disposable native target retained for inspection:", temporary);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
