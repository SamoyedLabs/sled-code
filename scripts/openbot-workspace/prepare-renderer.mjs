import * as NodeChildProcess from "node:child_process";
import { rendererSourceState, verifyRendererSource } from "./renderer-source.mjs";

const source = process.env.OPENBOT_SOURCE_DIRECTORY;
if (!source) throw new Error("Set OPENBOT_SOURCE_DIRECTORY to the maintained OpenBot checkout");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--apply"))
  throw new Error("Usage: prepare-renderer.mjs [--apply]");
const result = await rendererSourceState(source);
if (result.states.every((entry) => entry.state === "final")) {
  console.log("Renderer already matches the maintained patch.");
} else {
  if (!result.states.every((entry) => entry.state === "base"))
    throw new Error(
      "Renderer contains changed or partially applied files; preserve them and reconcile exact hashes before applying.",
    );
  const apply = (options) => {
    const command = NodeChildProcess.spawnSync(
      "git",
      ["apply", "--whitespace=error", ...options, "-"],
      { cwd: result.root, input: result.patch, encoding: "utf8" },
    );
    if (command.status !== 0) throw new Error(command.stderr || "Renderer patch failed");
  };
  apply(["--check"]);
  if (args[0] === "--apply") {
    apply([]);
    await verifyRendererSource(source);
    console.log("Applied and verified the maintained renderer patch.");
  } else
    console.log(
      "Exact renderer bases and patch preflight passed. Use --apply to prepare this checkout.",
    );
}
