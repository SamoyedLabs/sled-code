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
