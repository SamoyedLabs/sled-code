// Verify the actual ZIP, including signed native resources outside app.asar.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const archive = path.resolve(process.argv[2] || "");
assert(process.argv[2] && fs.statSync(archive).isFile(), "Pass a desktop ZIP path");
fs.mkdirSync(path.join(root, ".tools"), { recursive: true });
const temporary = fs.mkdtempSync(path.join(root, ".tools/package-verification-"));
try {
  cp.execFileSync("/usr/bin/ditto", ["-x", "-k", archive, temporary]);
  const apps = fs.readdirSync(temporary).filter((name) => name.endsWith(".app"));
  assert.equal(apps.length, 1, "Expected one desktop app in the ZIP");
  const app = path.join(temporary, apps[0]);
  const helper = path.join(app, "Contents/Resources/remote-desktop/T3RemoteHost.app");
  const outerSignature = cp.spawnSync("/usr/bin/codesign", ["-dv", app], { encoding: "utf8" });
  const outerTeamSigned = /^TeamIdentifier=(?!not set).+/m.test(outerSignature.stderr);
  if (outerTeamSigned)
    cp.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
      stdio: "pipe",
    });
  const links = [];
  function inspect(directory) {
    for (const name of fs.readdirSync(directory)) {
      const entry = path.join(directory, name);
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(entry);
        assert(!path.isAbsolute(target), `Absolute native link: ${path.relative(helper, entry)}`);
        const resolved = path.relative(helper, fs.realpathSync(entry));
        assert(
          resolved !== ".." && !resolved.startsWith("../") && !path.isAbsolute(resolved),
          `Native link leaves its bundle: ${path.relative(helper, entry)}`,
        );
        links.push(path.relative(helper, entry));
      } else if (stat.isDirectory()) inspect(entry);
    }
  }
  inspect(helper);
  assert(links.includes("Contents/Frameworks/LiveKitWebRTC.framework/Versions/Current"));
  cp.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", helper], {
    stdio: "pipe",
  });
  for (const name of [
    "Sill-LICENSE.txt",
    "Sill-MODIFICATIONS.md",
    "LiveKitWebRTC-LICENSE.txt",
    "LiveKitWebRTC-THIRD-PARTY-NOTICES.txt",
    "LiveKitWebRTC-PROVENANCE.json",
  ]) {
    assert(fs.statSync(path.join(helper, "Contents/Resources", name)).size > 0);
  }
  const provenance = JSON.parse(
    fs.readFileSync(path.join(helper, "Contents/Resources/LiveKitWebRTC-PROVENANCE.json"), "utf8"),
  );
  assert.equal(
    crypto
      .createHash("sha256")
      .update(
        fs.readFileSync(
          path.join(helper, "Contents/Resources/LiveKitWebRTC-THIRD-PARTY-NOTICES.txt"),
        ),
      )
      .digest("hex"),
    provenance.noticeBundleSha256,
  );
  assert.equal(
    provenance.archiveSha256,
    JSON.parse(fs.readFileSync(path.join(root, "sources.lock.json"), "utf8")).nativeWebRTCSpike
      .sha256,
  );
  const version = cp
    .execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents/Info.plist")],
      { encoding: "utf8" },
    )
    .trim();
  const result = {
    appVersion: version,
    appIdentifier: cp
      .execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleIdentifier", path.join(app, "Contents/Info.plist")],
        { encoding: "utf8" },
      )
      .trim(),
    helperSignatureValid: true,
    outerAppSignatureValid: outerTeamSigned,
    symlinkCount: links.length,
    nonportableLinks: [],
    noticesPresent: true,
    embeddedFrameworkPresent: true,
    archiveSHA256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
  };
  if (process.argv.includes("--runtime")) {
    cp.execFileSync(
      process.execPath,
      [
        path.join(__dirname, "test-helper-event-pipe.cjs"),
        "--helper",
        path.join(helper, "Contents/MacOS/T3RemoteHost"),
        "--persistent",
      ],
      { stdio: "inherit", timeout: 40000 },
    );
    result.persistentHelperRuntimePassed = true;
  }
  fs.mkdirSync(path.join(root, ".tools/evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".tools/evidence/desktop-package-check.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "PASS: extracted desktop ZIP has portable framework links and a valid signed native helper",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
