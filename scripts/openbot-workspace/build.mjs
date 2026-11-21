import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeFSP from "node:fs/promises";
import { verifyRendererSource } from "./renderer-source.mjs";

const repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
const source = process.env.OPENBOT_SOURCE_DIRECTORY;
if (!source)
  throw new Error("Set OPENBOT_SOURCE_DIRECTORY to the maintained OpenBot source checkout.");
const root = NodePath.resolve(source);
const rendererSource = await verifyRendererSource(root);
const require = NodeModule.createRequire(NodePath.resolve(root, "package.json"));
const pkg = JSON.parse(await NodeFSP.readFile(NodePath.resolve(root, "package.json"), "utf8"));
if (pkg.dependencies["solid-js"] !== "2.0.0-rc.18")
  throw new Error("Unsupported OpenBot Solid version");
const { build } = await import(require.resolve("vite"));
const solid = require("@solidjs/vite-plugin").default;
const tailwindModule = require("@tailwindcss/vite");
const tailwind = tailwindModule.default ?? tailwindModule;
const entry = NodePath.resolve(root, ".sled-workspace");
await NodeFSP.mkdir(entry, { recursive: true });
await NodeFSP.writeFile(
  NodePath.resolve(entry, "tsconfig.json"),
  JSON.stringify({
    extends: "../tsconfig.web.json",
    compilerOptions: { incremental: false },
    include: ["./*.tsx", "./*.ts", "../src/renderer/src/env.d.ts"],
  }),
);
for (const name of [
  "index.html",
  "main.tsx",
  "transport.ts",
  "browser.ts",
  "computer.tsx",
  "file-sources.ts",
  "task-refresh.ts",
  "theme.css",
])
  await NodeFSP.copyFile(
    NodePath.resolve(repo, "scripts/openbot-workspace", name),
    NodePath.resolve(entry, name),
  );
const entryHashes = {};
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
])
  entryHashes[name] = NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(NodePath.resolve(repo, "scripts/openbot-workspace", name)))
    .digest("hex");
const inputs = new Map();
await build({
  configFile: false,
  root: entry,
  base: "./",
  plugins: [
    solid(),
    tailwind({ optimize: false }),
    {
      name: "sled-openbot-lazy-catalogs",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("node_modules") && id.startsWith(root))
          inputs.set(
            id.slice(root.length + 1),
            NodeCrypto.createHash("sha256").update(code).digest("hex"),
          );
      },
      resolveId(id, importer) {
        if (
          importer?.includes("/packages/i18n/src/") &&
          ["./app-catalogs", "./source-catalogs", "./format-catalogs", "./locale-loading"].includes(
            id,
          )
        )
          return NodePath.resolve(root, "packages/i18n/src/lazy-catalogs.ts");
      },
    },
  ],
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  build: {
    outDir: NodePath.resolve(repo, "apps/web/public/openbot-workspace"),
    emptyOutDir: true,
    sourcemap: true,
  },
});

const toolchainInputs = {};
for (const name of ["package.json", "bun.lock"])
  toolchainInputs[name] = NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(NodePath.resolve(root, name)))
    .digest("hex");
const output = NodePath.resolve(repo, "apps/web/public/openbot-workspace");
const outputHashes = {};
for (const entry of await NodeFSP.readdir(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = NodePath.resolve(entry.parentPath, entry.name);
  outputHashes[path.slice(output.length + 1)] = NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(path))
    .digest("hex");
}

await NodeFSP.writeFile(
  NodePath.resolve(repo, "apps/web/public/openbot-workspace/build.json"),
  JSON.stringify(
    {
      entryHashes,
      rendererSource,
      toolchainInputs,
      outputHashes,
      upstreamVersion: pkg.version,
      solidVersion: pkg.dependencies["solid-js"],
      inputs: Object.fromEntries([...inputs].sort()),
    },
    null,
    2,
  ),
);
