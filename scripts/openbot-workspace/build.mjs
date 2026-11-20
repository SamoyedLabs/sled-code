import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, mkdir, copyFile, writeFile } from "node:fs/promises";
import { verifyRendererSource } from "./renderer-source.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = process.env.OPENBOT_SOURCE_DIRECTORY;
if (!source)
  throw new Error("Set OPENBOT_SOURCE_DIRECTORY to the maintained OpenBot source checkout.");
const root = resolve(source);
const rendererSource = await verifyRendererSource(root);
const require = createRequire(resolve(root, "package.json"));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (pkg.dependencies["solid-js"] !== "2.0.0-rc.18")
  throw new Error("Unsupported OpenBot Solid version");
const { build } = await import(require.resolve("vite"));
const solid = require("@solidjs/vite-plugin").default;
const tailwindModule = require("@tailwindcss/vite");
const tailwind = tailwindModule.default ?? tailwindModule;
const entry = resolve(root, ".sled-workspace");
await mkdir(entry, { recursive: true });
await writeFile(
  resolve(entry, "tsconfig.json"),
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
  await copyFile(resolve(repo, "scripts/openbot-workspace", name), resolve(entry, name));
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
  entryHashes[name] = createHash("sha256")
    .update(await readFile(resolve(repo, "scripts/openbot-workspace", name)))
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
          inputs.set(id.slice(root.length + 1), createHash("sha256").update(code).digest("hex"));
      },
      resolveId(id, importer) {
        if (
          importer?.includes("/packages/i18n/src/") &&
          ["./app-catalogs", "./source-catalogs", "./format-catalogs", "./locale-loading"].includes(
            id,
          )
        )
          return resolve(root, "packages/i18n/src/lazy-catalogs.ts");
      },
    },
  ],
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  build: {
    outDir: resolve(repo, "apps/web/public/openbot-workspace"),
    emptyOutDir: true,
    sourcemap: true,
  },
});

const toolchainInputs = {};
for (const name of ["package.json", "bun.lock"])
  toolchainInputs[name] = createHash("sha256")
    .update(await readFile(resolve(root, name)))
    .digest("hex");
const output = resolve(repo, "apps/web/public/openbot-workspace");
const outputHashes = {};
for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = resolve(entry.parentPath, entry.name);
  outputHashes[path.slice(output.length + 1)] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

await writeFile(
  resolve(repo, "apps/web/public/openbot-workspace/build.json"),
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
