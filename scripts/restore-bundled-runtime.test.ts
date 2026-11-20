// @effect-diagnostics nodeBuiltinImport:off -- Owned packaging fixtures exercise real symlink relocation.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import { expect, it } from "vite-plus/test";
const restore: (source: string, destination: string) => void = NodeModule.createRequire(
  import.meta.url,
)("./restore-bundled-runtime.cjs");
it("repairs builder-rewritten framework links so the output remains usable after the source disappears", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sled-runtime-links-"));
  try {
    const source = NodePath.join(root, "source"),
      output = NodePath.join(root, "output");
    for (const base of [source, output]) {
      await NodeFSP.mkdir(NodePath.join(base, "Versions/A/Resources"), { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(base, "Versions/A/Resources/owned.txt"),
        "owned native resource",
      );
    }
    await NodeFSP.symlink("A", NodePath.join(source, "Versions/Current"));
    await NodeFSP.symlink("Versions/Current/Resources", NodePath.join(source, "Resources"));
    await NodeFSP.symlink(
      NodePath.join(source, "Versions/A"),
      NodePath.join(output, "Versions/Current"),
    );
    await NodeFSP.symlink(
      NodePath.join(source, "Versions/Current/Resources"),
      NodePath.join(output, "Resources"),
    );
    restore(source, output);
    expect(await NodeFSP.readlink(NodePath.join(output, "Resources"))).toBe(
      "Versions/Current/Resources",
    );
    await NodeFSP.rm(source, { recursive: true });
    expect(await NodeFSP.readFile(NodePath.join(output, "Resources/owned.txt"), "utf8")).toBe(
      "owned native resource",
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("rejects accepted-bundle links that escape its own app", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sled-runtime-escape-"));
  try {
    const source = NodePath.join(root, "source"),
      output = NodePath.join(root, "output");
    await NodeFSP.mkdir(source);
    await NodeFSP.mkdir(output);
    await NodeFSP.writeFile(NodePath.join(root, "outside"), "outside");
    await NodeFSP.symlink("../outside", NodePath.join(source, "bad"));
    await NodeFSP.symlink("../outside", NodePath.join(output, "bad"));
    expect(() => restore(source, output)).toThrow("stay inside");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
