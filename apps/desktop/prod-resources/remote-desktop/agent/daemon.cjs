"use strict";
// Private per-user owner of the existing authenticated T3 backend and Swift host.
const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net"),
  cp = require("node:child_process"),
  readline = require("node:readline");
const {
  normalize,
  featureKeys,
  endpoint,
  secureDirectory,
  frames,
  send,
} = require("./protocol.cjs");
const home = process.argv[process.argv.indexOf("--home") + 1];
if (!home || !path.isAbsolute(home)) throw new Error("Missing host home");
const location = endpoint(home);
secureDirectory(location.dir);
const prefsFile = path.join(home, "userdata", "remote-desktop-host.json");
let prefs;
try {
  prefs = normalize(JSON.parse(fs.readFileSync(prefsFile, "utf8")));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  let previous = {};
  try {
    previous = JSON.parse(
      fs.readFileSync(path.join(home, "userdata", "desktop-settings.json"), "utf8"),
    ).remoteDesktop;
  } catch {}
  prefs = normalize(previous);
}
let pendingSettings = false;
let backend,
  native,
  config,
  ready = false,
  fingerprint = null,
  permissions = null,
  pairingUntil = 0,
  guiInstance = null,
  exiting = false,
  ownsSocket = false,
  socketInode;
let nativeRetries = 0,
  backendRetries = 0,
  nativeTimer,
  backendTimer,
  graceTimer;
const proxies = new Set(),
  subscribers = new Set(),
  browserTabs = new Map();
let browserBuffer = "";
function persist() {
  fs.mkdirSync(path.dirname(prefsFile), { recursive: true, mode: 0o700 });
  const tmp = prefsFile + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(prefs), { mode: 0o600 });
  fs.renameSync(tmp, prefsFile);
}
function snapshot() {
  return {
    enabled: prefs.enabled,
    ready,
    pairing: Date.now() < pairingUntil,
    lifecycle: prefs.lifecycle,
    preferences: Object.fromEntries(featureKeys.map((k) => [k, prefs[k]])),
    permissions,
    hostFingerprint: fingerprint,
    background: proxies.size === 0,
  };
}
function publish() {
  const value = snapshot();
  for (const s of subscribers) send(s, { type: "state", value });
}
function nativeWrite(line) {
  if (native?.stdin.writable) native.stdin.write(line + "\n");
}
function backendEvent(event) {
  if (backend?.stdio[8]?.writable) backend.stdio[8].write(JSON.stringify(event) + "\n");
}
function applySettings() {
  for (const key of featureKeys) nativeWrite(`setting ${key} ${prefs[key] ? 1 : 0}`);
  nativeWrite("agent-lifecycle " + prefs.lifecycle);
  nativeWrite("agent-gui " + (proxies.size ? 1 : 0));
}
function stopNative() {
  clearTimeout(nativeTimer);
  ready = false;
  fingerprint = null;
  pairingUntil = 0;
  backendEvent({ type: "unavailable" });
  const child = native;
  native = null;
  if (child) {
    child.stdin.end("quit\n");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  }
  publish();
}
function startNative() {
  if (native || !config || !prefs.enabled || exiting) return;
  const helper =
    process.env.T3_REMOTE_TEST_HELPER ||
    path.resolve(__dirname, "../T3RemoteHost.app/Contents/MacOS/T3RemoteHost");
  const child = cp.spawn(helper, [], {
    stdio: ["pipe", "ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      T3_REMOTE_EVENTS_FD: "3",
      T3_REMOTE_STATUS_ITEM: "1",
    },
  });
  native = child;
  child.stdin.on("error", () => {});
  child.on("error", () => {});
  const lines = readline.createInterface({ input: child.stdio[3] });
  lines.on("line", (line) => {
    if (native !== child || line.length > 262144 || !line.startsWith("T3RD ")) return;
    let event;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (event.type === "ready") {
      ready = true;
      fingerprint = event.hostFingerprint || null;
      permissions = event.permissions || null;
      applySettings();
      publish();
      const reset = setTimeout(() => {
        if (native === child) nativeRetries = 0;
      }, 60000);
      reset.unref();
      child.once("exit", () => clearTimeout(reset));
    } else if (event.type === "permissions") {
      permissions = {
        screenRecording: event.screenRecording === true,
        accessibility: event.accessibility === true,
      };
      publish();
    } else if (event.type === "native") backendEvent(event.event);
    else if (event.type === "pairing") {
      pairingUntil = event.expiresAt * 1000;
      publish();
    } else if (event.type === "agent-action") {
      void act(event).catch(() => {});
    }
  });
  const deadline = setTimeout(() => {
    if (native === child && !ready) child.kill("SIGTERM");
  }, 15000);
  deadline.unref();
  child.once("close", () => {
    lines.close();
    clearTimeout(deadline);
    if (native !== child) return;
    native = null;
    ready = false;
    fingerprint = null;
    backendEvent({ type: "unavailable" });
    publish();
    if (prefs.enabled && !exiting) {
      const delay = [250, 1000, 4000][nativeRetries++];
      if (delay === undefined) {
        prefs.enabled = false;
        persist();
        publish();
        if (!proxies.size) shutdown();
      } else nativeTimer = setTimeout(startNative, delay);
    }
  });
}
function openUI(settings) {
  pendingSettings = settings;
  if (proxies.size && subscribers.size) {
    for (const s of subscribers)
      send(s, { type: "ui-action", action: settings ? "settings" : "open" });
    return;
  }
  const app = process.env.T3_REMOTE_APP_BUNDLE;
  if (!app) return;
  const args = ["-a", app];
  if (settings) args.push("--args", "--t3-open-remote-settings");
  const child = cp.spawn("/usr/bin/open", args, { stdio: "ignore" });
  child.on("error", () => {});
}
async function act(command) {
  if (!command || typeof command !== "object") throw new Error("Invalid host action");
  switch (command.action) {
    case "enable":
      prefs.enabled = true;
      nativeRetries = 0;
      persist();
      startNative();
      break;
    case "disable":
      prefs.enabled = false;
      persist();
      stopNative();
      if (!proxies.size) setTimeout(shutdown, 50);
      break;
    case "lifecycle":
      if (!["with-t3", "persistent"].includes(command.value)) throw new Error("Invalid lifecycle");
      prefs.lifecycle = command.value;
      persist();
      applySettings();
      if (!proxies.size && prefs.lifecycle === "with-t3") setTimeout(shutdown, 50);
      break;
    case "setting":
      if (!featureKeys.includes(command.key) || typeof command.value !== "boolean")
        throw new Error("Invalid sharing setting");
      prefs[command.key] = command.value;
      persist();
      nativeWrite(`setting ${command.key} ${command.value ? 1 : 0}`);
      if (["remote", "internet"].includes(command.key) && !command.value)
        backendEvent({ type: "unavailable" });
      break;
    case "pair":
      if (!ready) throw new Error("Host is not ready");
      nativeWrite("pair");
      break;
    case "cancel-pairing":
      pairingUntil = 0;
      nativeWrite("cancel-pairing");
      break;
    case "forget-devices":
      nativeWrite("forget-devices");
      break;
    case "permissions":
      nativeWrite("request-permissions");
      break;
    case "open":
      openUI(false);
      break;
    case "settings":
      openUI(true);
      break;
    case "quit-ui":
      for (const s of subscribers) send(s, { type: "ui-action", action: "quit" });
      break;
    default:
      throw new Error("Invalid host action");
  }
  publish();
}
function startBackend() {
  if (backend || !config || exiting) return;
  const child = cp.spawn(process.execPath, [config.serverEntry, "--bootstrap-fd", "3"], {
    cwd: config.cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  backend = child;
  child.on("error", () => {});
  for (const fd of [3, 4, 6, 8]) child.stdio[fd].on("error", () => {});
  child.stdio[3].end(JSON.stringify(config.bootstrap) + "\n");
  for (const fd of [5, 7])
    child.stdio[fd].on("data", (data) => {
      const proxy = [...proxies][0];
      if (proxy) send(proxy, { type: "fd", fd, data: data.toString("base64") });
    });
  const commands = readline.createInterface({ input: child.stdio[9] });
  commands.on("line", (line) => {
    if (line.length > 262144) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    if (ready) nativeWrite(JSON.stringify({ type: "native-control", ...request }));
    else if (request.command?.type === "status")
      backendEvent({
        type: "reply",
        requestId: request.requestId,
        result: {
          type: "status",
          status: {
            available: true,
            enabled: false,
            remoteEnabled: prefs.remote,
            internetEnabled: prefs.internet,
            hostFingerprint: null,
          },
        },
      });
    else
      backendEvent({
        type: "reply",
        requestId: request.requestId,
        result: { type: "error", reason: "unavailable" },
      });
  });
  child.once("close", () => {
    commands.close();
    if (backend !== child) return;
    backend = null;
    for (const s of proxies) send(s, { type: "backend-exit" });
    if (exiting) return;
    stopNative();
    const delay = [500, 1500, 5000][backendRetries++];
    if (delay === undefined) {
      shutdown();
      return;
    }
    backendTimer = setTimeout(() => {
      startBackend();
      startNative();
    }, delay);
  });
  const healthy = setTimeout(() => {
    if (backend === child) backendRetries = 0;
  }, 60000);
  healthy.unref();
  child.once("exit", () => clearTimeout(healthy));
  startNative();
}
function disconnected(s) {
  subscribers.delete(s);
  if (!proxies.delete(s)) return;
  nativeWrite("agent-gui " + (proxies.size ? 1 : 0));
  for (const tab of browserTabs.values())
    if (backend?.stdio[6]?.writable)
      backend.stdio[6].write(JSON.stringify({ type: "detached", ...tab }) + "\n");
  browserTabs.clear();
  browserBuffer = "";
  publish();
  if (!proxies.size && (!prefs.enabled || prefs.lifecycle !== "persistent")) {
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      if (!proxies.size) shutdown();
    }, 1500);
  }
}
const server = net.createServer((s) => {
  s.on("error", () => {});
  s.on("close", () => disconnected(s));
  let attached = false;
  frames(s, (message) => {
    if (message.type === "attach") {
      if (
        attached ||
        !message.bootstrap ||
        path.resolve(message.bootstrap.t3Home || "") !== path.resolve(home) ||
        typeof message.serverEntry !== "string" ||
        typeof message.guiInstance !== "string"
      ) {
        s.destroy();
        return;
      }
      attached = true;
      clearTimeout(graceTimer);
      if (proxies.size) {
        send(s, {
          type: "result",
          error: "A desktop backend is already attached",
        });
        s.destroy();
        return;
      }
      if (config && message.serverEntry !== config.serverEntry) {
        send(s, {
          type: "result",
          error: "Reopen T3 Code after stopping the previous host version",
        });
        s.destroy();
        return;
      }
      proxies.add(s);
      if (!config)
        config = {
          bootstrap: message.bootstrap,
          serverEntry: message.serverEntry,
          cwd: message.cwd,
        };
      if (guiInstance !== message.guiInstance) {
        guiInstance = message.guiInstance;
        if (prefs.lifecycle === "persistent") {
          prefs.enabled = true;
          persist();
        }
      }
      if (message.bootstrap.desktopBootstrapSecret !== config.bootstrap.desktopBootstrapSecret) {
        proxies.delete(s);
        s.destroy();
        return;
      }
      startBackend();
      startNative();
      applySettings();
      send(s, { type: "attached" });
      publish();
    } else if (
      message.type === "fd" &&
      attached &&
      [4, 6].includes(message.fd) &&
      typeof message.data === "string"
    ) {
      const data = Buffer.from(message.data, "base64");
      if (data.length > 4 * 1024 * 1024) {
        s.destroy();
        return;
      }
      if (backend?.stdio[message.fd]?.writable) backend.stdio[message.fd].write(data);
      if (message.fd === 6) {
        try {
          browserBuffer += data.toString();
          if (browserBuffer.length > 8 * 1024 * 1024) {
            s.destroy();
            return;
          }
          let end;
          while ((end = browserBuffer.indexOf("\n")) >= 0) {
            const line = browserBuffer.slice(0, end);
            browserBuffer = browserBuffer.slice(end + 1);
            if (!line) continue;
            const e = JSON.parse(line);
            const key = e.threadId + ":" + e.tabId;
            if (e.type === "attached")
              browserTabs.set(key, { threadId: e.threadId, tabId: e.tabId });
            else if (e.type === "detached") browserTabs.delete(key);
          }
        } catch {}
      }
    } else if (message.type === "detach" && attached) {
      disconnected(s);
      s.end();
    } else if (message.type === "subscribe") {
      subscribers.add(s);
      send(s, { type: "state", value: snapshot() });
    } else if (message.type === "info") {
      send(s, {
        type: "result",
        value: config
          ? {
              port: config.bootstrap.port,
              secret: config.bootstrap.desktopBootstrapSecret,
            }
          : null,
      });
    } else if (message.type === "launch-route") {
      send(s, { type: "result", value: pendingSettings });
      pendingSettings = false;
    } else if (message.type === "state") {
      nativeWrite("permission-status");
      send(s, { type: "result", value: snapshot() });
    } else if (message.type === "action") {
      void act(message.command)
        .then(() => send(s, { type: "result", value: snapshot() }))
        .catch(() => send(s, { type: "result", error: "Remote desktop action failed" }));
    } else s.destroy();
  });
});
const idleDeadline = setTimeout(() => {
  if (!config) shutdown();
}, 15000);
idleDeadline.unref();
server.on("error", () => process.exit(1));
server.listen(location.socket, () => {
  ownsSocket = true;
  fs.chmodSync(location.socket, 0o600);
  socketInode = fs.lstatSync(location.socket).ino;
  persist();
});
function shutdown() {
  if (exiting) return;
  exiting = true;
  clearTimeout(nativeTimer);
  clearTimeout(backendTimer);
  clearTimeout(graceTimer);
  stopNative();
  for (const s of [...proxies, ...subscribers]) s.destroy();
  server.close();
  if (backend) {
    const child = backend;
    backend = null;
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    kill.unref();
  }
  try {
    if (ownsSocket && fs.lstatSync(location.socket).ino === socketInode)
      fs.unlinkSync(location.socket);
  } catch {}
  setTimeout(() => process.exit(0), 5500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
