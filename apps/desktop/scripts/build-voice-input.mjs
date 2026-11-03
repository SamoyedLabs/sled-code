import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const { values } = NodeUtil.parseArgs({
  options: { output: { type: "string" }, arch: { type: "string" } },
});
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone compiler script targets the host platform.
if (process.platform === "darwin") {
  const source = NodeURL.fileURLToPath(
    new URL("../../../native/voice-input/main.swift", import.meta.url),
  );
  const output =
    values.output ?? NodePath.resolve(NodePath.dirname(source), "build", "sled-voice-input");
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The compiler defaults to the host architecture.
  const arch = values.arch === "x64" ? "x86_64" : (values.arch ?? process.arch);
  NodeChildProcess.execFileSync(
    "xcrun",
    [
      "swiftc",
      "-parse-as-library",
      "-O",
      "-target",
      `${arch}-apple-macos13.0`,
      source,
      "-o",
      output,
    ],
    { stdio: "inherit" },
  );
} else if (values.output) {
  throw new Error("Building the Mac voice input helper requires macOS and Xcode.");
}
