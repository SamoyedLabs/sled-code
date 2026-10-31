// @effect-diagnostics nodeBuiltinImport:off -- Private same-user IPC with the packaged background host.
// @effect-diagnostics globalTimers:off -- Reconnect only while the Electron UI is alive.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { app, BrowserWindow } from "electron";
import { DesktopRemoteDesktopState, type DesktopRemoteDesktopCommand } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const remoteDesktopAgentProxy = () =>
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This imperative Electron boundary selects packaged Mac resources.
  app.isPackaged && process.platform === "darwin"
    ? NodePath.join(process.resourcesPath, "remote-desktop", "agent", "proxy.cjs")
    : undefined;
export const remoteDesktopAgentAvailable = () => {
  const proxy = remoteDesktopAgentProxy();
  return !!proxy && NodeFS.existsSync(proxy);
};
const socketPath = (home: string) =>
  NodePath.join(
    NodeOS.tmpdir(),
    `t3rd-${process.getuid?.()}-${NodeCrypto.createHash("sha256").update(NodePath.resolve(home)).digest("hex").slice(0, 20)}`,
    "host.sock",
  );
function listen(socket: NodeNet.Socket, receive: (message: unknown) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        receive(JSON.parse(line));
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}
function rpc(home: string, request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(socketPath(home));
    const timer = setTimeout(() => finish(new Error("Background host unavailable")), 2000);
    let done = false;
    function finish(error: Error | null, value?: unknown) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("Background host disconnected")));
    listen(socket, (message) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("type" in message) ||
        message.type !== "result"
      )
        return;
      if ("error" in message) finish(new Error("Background host action failed"));
      else finish(null, "value" in message ? message.value : undefined);
    });
  });
}
export async function existingRemoteDesktopAgent(
  home: string,
): Promise<{ port: number; secret: string } | null> {
  if (!remoteDesktopAgentAvailable()) return null;
  try {
    const info = await rpc(home, { type: "info" });
    if (
      info &&
      typeof info === "object" &&
      "port" in info &&
      typeof info.port === "number" &&
      info.port > 0 &&
      info.port <= 65535 &&
      "secret" in info &&
      typeof info.secret === "string" &&
      /^[a-f0-9]{64}$/.test(info.secret)
    )
      return { port: info.port, secret: info.secret };
  } catch {
    /* An app launch creates the host when none is running. */
  }
  return null;
}
const decode = Schema.decodeUnknownSync(DesktopRemoteDesktopState);
export const readAgentState = async (home: string) => decode(await rpc(home, { type: "state" }));
export const changeAgentState = async (home: string, command: DesktopRemoteDesktopCommand) => {
  await rpc(home, { type: "action", command });
};
export function subscribeAgent(
  home: string,
  update: (state: DesktopRemoteDesktopState) => void,
  showSettings: () => void,
) {
  let socket: NodeNet.Socket | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const show = (settings: boolean) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
    app.focus({ steal: true });
    if (settings) {
      if (window) void consumeRemoteDesktopSettingsLaunch(home);
      showSettings();
    }
  };
  function connect() {
    if (stopped) return;
    const current = NodeNet.createConnection(socketPath(home));
    socket = current;
    current.on("error", () => {});
    current.on("close", () => {
      if (!stopped) retry = setTimeout(connect, 500);
    });
    current.on("connect", () => current.write('{"type":"subscribe"}\n'));
    listen(current, (message) => {
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "state" && "value" in message) update(decode(message.value));
      if (message.type === "ui-action" && "action" in message) {
        if (message.action === "quit") app.quit();
        else show(message.action === "settings");
      }
    });
  }
  connect();
  const quit = () => {
    stopped = true;
    clearTimeout(retry);
    socket?.destroy();
  };
  app.once("before-quit", quit);
  app.on("second-instance", (_event, args) => {
    if (args.includes("--t3-open-remote-settings")) show(true);
  });
  return quit;
}

export async function consumeRemoteDesktopSettingsLaunch(home: string): Promise<boolean> {
  if (!remoteDesktopAgentAvailable()) return false;
  try {
    return (await rpc(home, { type: "launch-route" })) === true;
  } catch {
    return false;
  }
}
