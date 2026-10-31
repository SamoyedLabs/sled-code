const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { decide, readWorkspace } = require("./ci-changes.cjs");
const packages = readWorkspace();

test("Mac host source edits require the native compiler gate", () => {
  const { outputs } = decide(
    ["native/remote-desktop/Sources/SillHost/RemoteServer.swift"],
    packages,
    false,
  );
  assert.equal(outputs.remote_native, true);
});

test("WebRTC dependency and preparation changes require the native compiler gate", () => {
  for (const file of [
    "sources.lock.json",
    "scripts/sled/prepare-native.py",
    "scripts/prepare-webrtc.py",
  ]) {
    assert.equal(decide([file], packages, false).outputs.remote_native, true, file);
  }
});

test("ordinary web edits avoid native host and mobile lint jobs", () => {
  const { outputs } = decide(["apps/web/src/components/Test.tsx"], packages, false);
  assert.equal(outputs.remote_native, false);
  assert.equal(outputs.mobile_native, false);
  assert.equal(outputs.test_web, true);
});

test("unknown dispatch diff fails open including native gates", () => {
  const { outputs } = decide(null, packages, false);
  assert.equal(outputs.remote_native, true);
  assert.equal(outputs.mobile_native, true);
  assert.equal(outputs.test_server, true);
});

test("docs alone do not start native compilers", () => {
  const { outputs } = decide(["docs/user/example.md"], packages, false);
  assert.equal(outputs.remote_native, false);
  assert.equal(outputs.mobile_native, false);
  assert.equal(outputs.test, false);
});

test("docs-only changes skip application checks", () => {
  const { outputs, affected } = decide(
    [
      "README.md",
      "docs/user/setup.md",
      "docs/assets/remote-workspace.png",
      "docs/assets/remote-workspace.svg",
    ],
    packages,
    true,
  );
  assert.deepEqual(affected, []);
  assert.equal(outputs.docs, true);
  for (const [gate, required] of Object.entries(outputs)) {
    if (["docs", "docs_files", "test_packages"].includes(gate)) continue;
    assert.equal(required, false, gate);
  }
});

test("explicit full validation retains broad coverage for application changes", () => {
  const { outputs } = decide(["README.md", "apps/web/src/App.tsx"], packages, true);
  assert.equal(outputs.docs, false);
  assert.equal(outputs.lint, true);
  assert.equal(outputs.test_web, true);
  assert.equal(outputs.test_server, true);
  assert.equal(outputs.release_smoke, true);
});

test("an unavailable push diff fails open instead of claiming documentation only", () => {
  const { outputs } = decide(null, packages, true);
  assert.equal(outputs.docs, false);
  for (const gate of [
    "lint",
    "automation",
    "test",
    "test_web",
    "test_server",
    "remote_native",
    "mobile_native",
  ]) {
    assert.equal(outputs[gate], true, gate);
  }
});

test("docs-only pull requests need formatting but no application checks", () => {
  const { outputs } = decide(["README.md"], packages, false);
  assert.equal(outputs.docs, true);
  assert.equal(outputs.lint, false);
  assert.equal(outputs.automation, false);
  assert.equal(outputs.test_web, false);
  assert.equal(outputs.test_server, false);
});

test("unknown source paths retain full application coverage", () => {
  const { outputs } = decide(["unrecognized-source.custom"], packages, false);
  assert.equal(outputs.docs, false);
  assert.equal(outputs.test_web, true);
  assert.equal(outputs.test_server, true);
});

test("automation safeguards run for CI changes rather than ordinary application edits", () => {
  assert.equal(decide(["apps/web/src/App.tsx"], packages, true).outputs.automation, false);
  assert.equal(decide([".github/workflows/ci.yml"], packages, false).outputs.automation, true);
  assert.equal(decide(["scripts/sled/upstream.py"], packages, false).outputs.automation, true);
});

// Keep these routes narrow without hiding mixed changes or newly introduced files.
test("maintenance routing does not fan out into application or native tests", () => {
  for (const file of [
    ".github/scripts/ci-changes.cjs",
    ".github/scripts/ci-changes.test.cjs",
    ".github/actions/ci-changes/action.yml",
    ".github/workflows/sled-upstream.yml",
    "scripts/sled/upstream.py",
    "scripts/sled/upstream_test.py",
    "config/sled-upstream.json",
  ]) {
    const { outputs, affected } = decide(["README.md", file], packages, false);
    assert.deepEqual(affected, [], file);
    assert.equal(outputs.automation, true, file);
    for (const gate of [
      "test",
      "test_web",
      "test_server",
      "build",
      "typecheck",
      "rust",
      "release_smoke",
      "remote_native",
      "mobile_native",
    ]) {
      assert.equal(outputs[gate], false, `${file}: ${gate}`);
    }
  }
});

test("native host changes compile the host without running unrelated application suites", () => {
  const { outputs, affected } = decide(
    ["native/remote-desktop/Sources/SillHost/RemoteServer.swift"],
    packages,
    false,
  );
  assert.deepEqual(affected, []);
  assert.equal(outputs.remote_native, true);
  for (const gate of [
    "test",
    "test_web",
    "test_server",
    "rust",
    "mobile_native",
    "release_smoke",
  ]) {
    assert.equal(outputs[gate], false, gate);
  }
});

test("shared build setup and unknown paths still require broad validation", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "package.json",
    ".github/workflows/ci.yml",
    ".github/actions/setup-ci-deps/action.yml",
    "new-runtime/source.custom",
  ]) {
    const { outputs } = decide([file], packages, false);
    for (const gate of [
      "build",
      "typecheck",
      "test",
      "test_web",
      "test_server",
      "rust",
      "remote_native",
      "mobile_native",
    ]) {
      assert.equal(outputs[gate], true, `${file}: ${gate}`);
    }
  }
});

test("mixed maintenance and source changes retain affected packages and dependents", () => {
  const files = ["packages/contracts/src/example.ts"];
  const source = decide(files, packages, false);
  const mixed = decide([...files, "scripts/sled/upstream.py"], packages, false);
  assert.deepEqual(mixed.affected, source.affected);
  assert.equal(mixed.outputs.automation, true);
  assert.equal(mixed.outputs.test_server, true);
  assert.equal(mixed.outputs.test_web, true);
});

test("the action scopes main pushes like PRs and runs everything when git cannot diff", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sled-ci-routing-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Isolate the Git boundary; execute the actual composite action and router.
  fs.writeFileSync(
    path.join(directory, "git"),
    '#!/bin/bash\nif [[ "$1" == fetch ]]; then exit 0; fi\nif [[ "$1" == diff && "$CI_TEST_DIFF_FAIL" != 1 ]]; then echo apps/web/src/App.tsx; exit 0; fi\nexit 1\n',
    { mode: 0o755 },
  );
  const action = fs.readFileSync(path.join(__dirname, "../actions/ci-changes/action.yml"), "utf8");
  const script = action.split("      run: |\n")[1].replace(/^        /gm, "");
  for (const event of ["pull_request", "push"]) {
    for (const missing of [false, true]) {
      const output = path.join(directory, "output");
      fs.writeFileSync(output, "");
      const result = spawnSync("bash", ["-c", script], {
        cwd: path.join(__dirname, "../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          EVENT_NAME: event,
          BEFORE_SHA: "base",
          RUNNER_TEMP: directory,
          GITHUB_OUTPUT: output,
          CI_TEST_DIFF_FAIL: missing ? "1" : "0",
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const outputs = Object.fromEntries(
        fs
          .readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );
      assert.equal(outputs.test_web, "true");
      assert.equal(outputs.test_server, String(missing), `${event}, missing diff: ${missing}`);
      assert.equal(outputs.remote_native, String(missing));
    }
  }
});
