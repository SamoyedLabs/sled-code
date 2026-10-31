// @effect-diagnostics nodeBuiltinImport:off -- Read-only native TCC probes run in the same helper/responsible app as capture and input.
import * as NodeChildProcess from "node:child_process";
import { app, dialog } from "electron";
import * as Schema from "effect/Schema";

const Permissions = Schema.Struct({
  screenRecording: Schema.Boolean,
  accessibility: Schema.Boolean,
});
const decode = Schema.decodeUnknownSync(Permissions);
export type Permissions = typeof Permissions.Type;
export type Permission = "screen-recording" | "accessibility";
const denied: Permissions = { screenRecording: false, accessibility: false };

export function inspectRemoteDesktopPermissions(executable: string): Promise<Permissions> {
  const env = { ...process.env };
  delete env.T3_REMOTE_EVENTS_FD;
  return new Promise((resolve) =>
    NodeChildProcess.execFile(
      executable,
      ["--permission-status"],
      { env, timeout: 5000, maxBuffer: 4096 },
      (error, stdout) => {
        try {
          if (error) {
            resolve(denied);
            return;
          }
          const line = stdout.split("\n").find((value) => value.startsWith("T3RD "));
          resolve(decode(JSON.parse(line?.slice(5) ?? "null")));
        } catch {
          resolve(denied);
        }
      },
    ),
  );
}

export async function setUpRemoteDesktopPermissions(
  executable: string,
  showHelper: (permission: Permission, isGranted: () => Promise<boolean>) => Promise<void>,
  explicit: boolean,
) {
  const state = await inspectRemoteDesktopPermissions(executable);
  if (state.screenRecording && state.accessibility && !explicit) return;
  const result = await dialog.showMessageBox({
    type: "info",
    title: "Remote desktop permissions",
    message:
      state.screenRecording && state.accessibility
        ? "This Mac is ready to share and control."
        : "Allow screen sharing and remote control on this Mac.",
    detail: `Screen Recording: ${state.screenRecording ? "Allowed" : "Needs access"}\nAccessibility: ${state.accessibility ? "Allowed" : "Needs access"}\n\nEnable T3 Code, or T3 Remote Desktop if macOS lists the helper. Reopen T3 Code if macOS asks. Clipboard, audio and virtual displays remain available.`,
    buttons: ["Done", "Screen Recording…", "Accessibility…"],
    defaultId: 0,
    cancelId: 0,
  });
  const permission =
    result.response === 1
      ? "screen-recording"
      : result.response === 2
        ? "accessibility"
        : undefined;
  if (!permission) return;
  const env = { ...process.env };
  delete env.T3_REMOTE_EVENTS_FD;
  const request = NodeChildProcess.spawn(
    executable,
    [permission === "screen-recording" ? "--request-screen-recording" : "--request-accessibility"],
    { env, stdio: "ignore" },
  );
  request.on("error", () => {});
  const stopRequest = () => {
    request.kill("SIGTERM");
  };
  app.once("before-quit", stopRequest);
  request.once("exit", () => app.removeListener("before-quit", stopRequest));
  await showHelper(permission, async () => {
    const current = await inspectRemoteDesktopPermissions(executable);
    return permission === "screen-recording" ? current.screenRecording : current.accessibility;
  });
}
