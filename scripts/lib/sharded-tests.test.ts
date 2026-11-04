// @effect-diagnostics nodeBuiltinImport:off - verifies Vitest discovery in a disposable project.
import { expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { shardedTestFiles } from "./sharded-tests.ts";

it("uses the configured sequencer and discovers every file exactly once", async () => {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "test-shards-")),
  );
  try {
    await NodeFSP.mkdir(NodePath.join(root, "node_modules"));
    await NodeFSP.symlink(
      NodePath.resolve(import.meta.dirname, "../../node_modules/vite-plus"),
      NodePath.join(root, "node_modules/vite-plus"),
      "dir",
    );
    await NodeFSP.writeFile(NodePath.join(root, "package.json"), '{"type":"module"}');
    await NodeFSP.writeFile(
      NodePath.join(root, "vite.config.ts"),
      `import {weightedShardSequencer} from ${JSON.stringify(new URL("./weighted-shard-sequencer.ts", import.meta.url).href)};
       const Sequencer = weightedShardSequencer({
         "included/a.test.ts": 9,
         "included/b.test.ts": 4,
         "included/c.test.ts": 3,
         "included/d.spec.ts": 2,
       });
       export default {test:{include:["included/*.{test,spec}.ts"],sequence:{sequencer:Sequencer}}};`,
    );
    await NodeFSP.mkdir(NodePath.join(root, "included"));
    for (const file of [
      "included/a.test.ts",
      "included/b.test.ts",
      "included/c.test.ts",
      "included/d.spec.ts",
      "included/e.test.ts",
      "excluded.test.ts",
    ]) {
      await NodeFSP.writeFile(NodePath.join(root, file), "export {};");
    }
    const first = await shardedTestFiles(root, "1/2");
    const second = await shardedTestFiles(root, "2/2");
    expect(first).toEqual(
      ["a", "e"].map((file) => NodePath.join(root, `included/${file}.test.ts`)),
    );
    expect(second).toEqual([
      NodePath.join(root, "included/b.test.ts"),
      NodePath.join(root, "included/c.test.ts"),
      NodePath.join(root, "included/d.spec.ts"),
    ]);
    expect(new Set([...first, ...second]).size).toBe(5);
    await expect(shardedTestFiles(root, "0/2")).rejects.toThrow("Shard must be");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
