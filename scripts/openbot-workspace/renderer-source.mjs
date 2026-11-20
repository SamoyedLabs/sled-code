import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const directory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const sha256 = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

export async function rendererSourceState(source) {
  const root = NodePath.resolve(source);
  if ((await NodeFSP.realpath(root)) !== root)
    throw new Error("Renderer checkout has a linked ancestor");
  const manifest = JSON.parse(
    await NodeFSP.readFile(NodePath.resolve(directory, "upstream-renderer.json"), "utf8"),
  );
  const patch = await NodeFSP.readFile(NodePath.resolve(directory, "upstream-renderer.patch"));
  if (sha256(patch) !== manifest.patchSha256) throw new Error("Renderer patch identity changed");
  const states = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const target = NodePath.resolve(root, name);
    const within = NodePath.relative(root, target);
    if (!within || within.startsWith("..") || NodePath.isAbsolute(within))
      throw new Error("Invalid renderer path");
    let current = root;
    for (const part of ["", ...within.split("/")]) {
      current = NodePath.resolve(current, part);
      const info = await NodeFSP.lstat(current).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (info?.isSymbolicLink()) throw new Error(`Linked renderer path: ${name}`);
    }
    const bytes = await NodeFSP.readFile(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const actual = bytes === null ? null : sha256(bytes);
    states.push({
      name,
      state:
        actual === expected.sha256 ? "final" : actual === expected.baseSha256 ? "base" : "conflict",
    });
  }
  return { root, manifest, patch, states };
}

export async function verifyRendererSource(source) {
  const result = await rendererSourceState(source);
  const unresolved = result.states.filter((entry) => entry.state !== "final");
  if (unresolved.length)
    throw new Error(
      `Workspace renderer is not prepared: ${unresolved.map((entry) => `${entry.name} (${entry.state})`).join(", ")}. Run scripts/openbot-workspace/prepare-renderer.mjs against this checkout.`,
    );
  return result.manifest;
}
