import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeModule from "node:module";
import { build } from "vite-plus";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

async function generateWebViewScript(feature: string, name: string) {
  const stem = `${name.toLowerCase()}-stream`;
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodePath.join(mobileRoot, "src/features", feature, `${stem}.browser.ts`),
        name: `T3${name}Stream`,
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const chunk = bundles
    .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error(`${name} build did not emit a script.`);
  const root = NodePath.join(mobileRoot, ".generated", stem);
  await NodeFSP.mkdir(root, { recursive: true });
  for (const [file, contents] of [
    ["index.js", `module.exports = ${JSON.stringify(chunk.code)};\n`],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(root, file);
    const previous = await NodeFSP.readFile(destination, "utf8").catch(() => null);
    if (previous !== contents) await NodeFSP.writeFile(destination, contents);
  }
}

export const generateDeviceStreamScript = () => generateWebViewScript("devices", "Device");
export const generatePreviewStreamScript = () => generateWebViewScript("browser", "Preview");

export async function generateMermaidPage() {
  const require = NodeModule.createRequire(import.meta.url);
  const mermaid = await NodeFSP.readFile(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodePath.join(
          mobileRoot,
          "src/features/bots/upstream/openbot-mobile/chat-preview/mermaid-renderer.browser.ts",
        ),
        name: "SledMermaid",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const worker = bundles
    .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
    .find((entry) => entry.type === "chunk");
  if (!worker) throw new Error("Mermaid build did not emit a script.");
  const root = NodePath.join(mobileRoot, ".generated", "mermaid-page");
  await NodeFSP.mkdir(root, { recursive: true });
  const javascript = (mermaid + "\n" + worker.code).replace(/<\/script/gi, "<\\/script");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>${javascript}</script></body></html>`;
  for (const [file, contents] of [
    ["mermaid.html", html],
    ["index.js", "module.exports = require('./mermaid.html');\n"],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(root, file);
    if ((await NodeFSP.readFile(destination, "utf8").catch(() => null)) !== contents)
      await NodeFSP.writeFile(destination, contents);
  }
}
