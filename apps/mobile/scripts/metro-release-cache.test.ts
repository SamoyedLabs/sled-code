import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it("retains release transforms across processes while regenerating non-cacheable CSS", () => {
  const cache = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sled-metro-cache-"));
  const run = (operation: "write" | "read") =>
    NodeChildProcess.execFileSync(
      process.execPath,
      [
        "-e",
        `
          const assert = require('node:assert/strict');
          (async () => {
            const config = await require('./metro.config.js');
            const store = config.cacheStores[0];
            const key = Buffer.from('persistent-release-transform');
            const cssKey = Buffer.from('regenerated-release-css');
            const value = { output: [{ type: 'js/module', data: { code: 'module.exports = 42;' } }] };
            if (${JSON.stringify(operation)} === 'write') {
              await store.set(key, value);
              await store.set(cssKey, { output: [{ data: { css: { skipCache: true } } }] });
            } else {
              assert.deepEqual(await store.get(key), value);
              assert.equal(await store.get(cssKey), null);
            }
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, NODE_ENV: "production", SLED_METRO_CACHE_DIR: cache },
        encoding: "utf8",
      },
    );
  try {
    run("write");
    expect(
      NodeFS.readdirSync(NodePath.join(cache, "transforms"), {
        recursive: true,
        withFileTypes: true,
      }).filter((entry) => entry.isFile()),
    ).toHaveLength(1);
    run("read");
  } finally {
    NodeFS.rmSync(cache, { recursive: true, force: true });
  }
});
