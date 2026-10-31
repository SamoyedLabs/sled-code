const assert = require("node:assert/strict");
const { test } = require("node:test");
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

test("docs-only pushes keep application checks skipped despite the full main backstop", () => {
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

test("a mixed docs and application push retains the full main backstop", () => {
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

test("unknown source paths on main retain full application coverage", () => {
  const { outputs } = decide(["unrecognized-source.custom"], packages, true);
  assert.equal(outputs.docs, false);
  assert.equal(outputs.test_web, true);
  assert.equal(outputs.test_server, true);
});

test("automation safeguards run for CI changes rather than ordinary application edits", () => {
  assert.equal(decide(["apps/web/src/App.tsx"], packages, true).outputs.automation, false);
  assert.equal(decide([".github/workflows/ci.yml"], packages, false).outputs.automation, true);
  assert.equal(decide(["scripts/sled/upstream.py"], packages, false).outputs.automation, true);
});
