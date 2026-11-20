// @effect-diagnostics nodeBuiltinImport:off -- Vite builds run before the application Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import type { Plugin } from "vite-plus";

/** Solid is compiled by its own pinned upstream toolchain; React never parses its TSX. */
export function openbotWorkspacePlugin(): Plugin {
  return {
    name: "sled:openbot-workspace",
    apply: "build",
    buildStart() {
      const root = new URL("../../../", import.meta.url);
      if (process.env.OPENBOT_SOURCE_DIRECTORY) {
        NodeChildProcess.execFileSync(
          process.execPath,
          [NodeURL.fileURLToPath(new URL("scripts/openbot-workspace/build.mjs", root))],
          { cwd: NodeURL.fileURLToPath(root), stdio: "inherit" },
        );
        return;
      }
      try {
        const manifest = JSON.parse(
          NodeFS.readFileSync(
            new URL("apps/web/public/openbot-workspace/build.json", root),
            "utf8",
          ),
        );
        for (const name of [
          "main.tsx",
          "transport.ts",
          "browser.ts",
          "computer.tsx",
          "file-sources.ts",
          "task-refresh.ts",
          "theme.css",
          "index.html",
          "build.mjs",
          "renderer-source.mjs",
          "upstream-renderer.json",
          "upstream-renderer.patch",
        ]) {
          const hash = NodeCrypto.createHash("sha256")
            .update(NodeFS.readFileSync(new URL(`scripts/openbot-workspace/${name}`, root)))
            .digest("hex");
          if (manifest.entryHashes?.[name] !== hash) throw new Error("Stale workspace assets");
        }
        if (!manifest.outputHashes?.["index.html"])
          throw new Error("Missing workspace payload manifest");
        for (const [name, expected] of Object.entries(manifest.outputHashes)) {
          const hash = NodeCrypto.createHash("sha256")
            .update(NodeFS.readFileSync(new URL(`apps/web/public/openbot-workspace/${name}`, root)))
            .digest("hex");
          if (hash !== expected)
            throw new Error("Workspace payload differs from its build manifest");
        }
      } catch {
        throw new Error(
          "Build the Bots workspace with OPENBOT_SOURCE_DIRECTORY=<maintained OpenBot checkout> vp run build:openbot-workspace before building web or desktop.",
        );
      }
    },
  };
}
