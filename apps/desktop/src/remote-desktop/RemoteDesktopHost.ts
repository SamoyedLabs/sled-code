// @effect-diagnostics nodeBuiltinImport:off -- This Electron boundary owns the native helper process and its pipes.
// @effect-diagnostics globalTimers:off -- The child shutdown deadline must work while Electron's Effect runtime is quitting.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeStream from "node:stream";
import { app, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { RemoteDesktopNativeEvent, type RemoteDesktopNativeRequest } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { DesktopRemoteDesktopCommand, DesktopRemoteDesktopState } from "@t3tools/contracts";
import { inspectRemoteDesktopPermissions } from "./RemoteDesktopPermissions.ts";
import {
  DEFAULT_REMOTE_DESKTOP,
  type RemoteDesktopPreferences,
} from "./RemoteDesktopPreferences.ts";

import {
  remoteDesktopAgentAvailable,
  subscribeAgent,
  readAgentState,
  changeAgentState,
} from "./RemoteDesktopAgentClient.ts";
let managedHome: string | undefined;
let lifecycle: "with-t3" | "persistent" = "with-t3";

let helper: NodeChildProcess.ChildProcess | undefined;
let quitting = false;
let ready = false;
let hostFingerprint: string | null = null;
let nativeTransportReady = false;
let desired = false;
let stoppingHelper: NodeChildProcess.ChildProcess | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let healthyTimer: ReturnType<typeof setTimeout> | undefined;
let restartAttempts = 0;
let configured = false;
let savePreferences: ((preferences: RemoteDesktopPreferences) => Promise<unknown>) | undefined;
let permissionSetup: ((explicit: boolean) => Promise<void>) | undefined;
let nativePermissions = false;
let pairing = false;
let showSettings: (() => void) | undefined;
const nativeObservers = new Set<(event: RemoteDesktopNativeEvent) => void>();
const decodeNativeEvent = Schema.decodeUnknownOption(RemoteDesktopNativeEvent);
const emitNative = (event: RemoteDesktopNativeEvent) => {
  for (const observer of nativeObservers) observer(event);
};

export function observeRemoteDesktopNative(observer: (event: RemoteDesktopNativeEvent) => void) {
  nativeObservers.add(observer);
  return () => {
    nativeObservers.delete(observer);
  };
}

export function sendRemoteDesktopNative(request: RemoteDesktopNativeRequest) {
  const command = request.command;
  if (command.type === "status") {
    if (ready && nativeTransportReady && nativePermissions) {
      helper?.stdin?.write(JSON.stringify({ type: "native-control", ...request }) + "\n");
      return;
    }
    emitNative({
      type: "reply",
      requestId: request.requestId,
      result: {
        type: "status",
        status: {
          // oxlint-disable-next-line t3code/no-global-process-runtime -- This imperative Electron/helper boundary reports host availability outside the Effect runtime.
          available: process.platform === "darwin",
          enabled: ready,
          remoteEnabled: settings.remote ?? false,
          internetEnabled: settings.internet ?? false,
          hostFingerprint,
        },
      },
    });
    return;
  }
  if (command.type === "stop" && (!ready || !nativeTransportReady)) {
    emitNative({
      type: "reply",
      requestId: request.requestId,
      result: { type: "stopped", sessionId: command.sessionId },
    });
    return;
  }
  if (command.type !== "stop" && (!ready || !settings.remote || !settings.internet)) {
    emitNative({
      type: "reply",
      requestId: request.requestId,
      result: { type: "error", reason: "disabled" },
    });
    return;
  }
  if (!nativeTransportReady) {
    emitNative({
      type: "reply",
      requestId: request.requestId,
      result: { type: "error", reason: "unavailable" },
    });
    return;
  }
  helper?.stdin?.write(JSON.stringify({ type: "native-control", ...request }) + "\n");
}
const settings: Record<string, boolean> = {
  clipboard: true,
  "virtual-display": true,
  audio: true,
  "direct-wireless": false,
  remote: DEFAULT_REMOTE_DESKTOP.remote,
  internet: DEFAULT_REMOTE_DESKTOP.internet,
};
const settingKeys = [
  "clipboard",
  "virtual-display",
  "audio",
  "direct-wireless",
  "remote",
  "internet",
] as const;

// Called after T3 has loaded its normal settings and initialized Electron.
export function configureRemoteDesktopHost(
  preferences: RemoteDesktopPreferences,
  save: (preferences: RemoteDesktopPreferences) => Promise<unknown>,
  setUpPermissions?: (explicit: boolean) => Promise<void>,
  openSettings?: () => void,
  home?: string,
) {
  if (configured) return;
  configured = true;
  for (const key of settingKeys) settings[key] = preferences[key];
  savePreferences = save;
  permissionSetup = setUpPermissions;
  showSettings = openSettings;
  lifecycle = preferences.lifecycle;
  if (home && remoteDesktopAgentAvailable()) {
    managedHome = home;
    subscribeAgent(
      home,
      (state) => {
        desired = state.enabled;
        ready = state.ready;
        lifecycle = state.lifecycle;
        Object.assign(settings, state.preferences);
        refreshRemoteDesktopMenu();
      },
      () => showSettings?.(),
    );
    return;
  }
  if (preferences.enabled) {
    desired = true;
    launch();
  }
}

function persist() {
  refreshRemoteDesktopMenu();
  const preferences = {
    ...DEFAULT_REMOTE_DESKTOP,
    ...settings,
    lifecycle,
    enabled: desired,
  };
  void savePreferences?.(preferences).catch(() => {
    dialog.showErrorBox(
      "Remote desktop settings",
      "The change applies to this session, but T3 Code could not save it. Check that its settings directory is writable.",
    );
  });
}

function disable() {
  if (managedHome) {
    void changeAgentState(managedHome, { action: "disable" });
    return;
  }
  stop();
  persist();
}

let lifecycleInstalled = false;

function stop() {
  desired = false;
  pairing = false;
  clearTimeout(restartTimer);
  restartTimer = undefined;
  clearTimeout(healthyTimer);
  healthyTimer = undefined;
  ready = false;
  nativeTransportReady = false;
  nativePermissions = false;
  hostFingerprint = null;
  emitNative({ type: "unavailable" });
  const owned = helper;
  if (!owned || stoppingHelper === owned) return;
  stoppingHelper = owned;
  owned.stdin?.end("quit\n");
  const deadline = setTimeout(() => owned.kill("SIGTERM"), 1500);
  const hardDeadline = setTimeout(() => owned.kill("SIGKILL"), 4000);
  deadline.unref();
  hardDeadline.unref();
  owned.once("exit", () => {
    clearTimeout(deadline);
    clearTimeout(hardDeadline);
  });
}

function start() {
  if (managedHome) {
    void changeAgentState(managedHome, { action: "enable" });
    return;
  }
  if (quitting) return;
  desired = true;
  persist();
  restartAttempts = 0;
  clearTimeout(restartTimer);
  restartTimer = undefined;
  launch();
  void permissionSetup?.(false).catch(() =>
    dialog.showErrorBox(
      "Remote desktop permissions",
      "Open Remote Desktop → Set up permissions to check Screen Recording and Accessibility.",
    ),
  );
}

export function remoteDesktopExecutable(): string | undefined {
  const relative = ["remote-desktop", "T3RemoteHost.app", "Contents", "MacOS", "T3RemoteHost"];
  // T3's dev launcher passes the desktop root because Electron's appPath can
  // name dist-electron when launched with a main script rather than a package.
  const devRoot = app.commandLine.getSwitchValue("t3code-dev-root");
  const candidates = app.isPackaged
    ? [NodePath.join(process.resourcesPath, ...relative)]
    : [devRoot, app.getAppPath(), NodePath.dirname(app.getAppPath())]
        .filter(Boolean)
        .map((root) => NodePath.join(root, "prod-resources", ...relative));
  return candidates.find((candidate) => NodeFS.existsSync(candidate));
}

function launch() {
  if (helper || quitting || !desired) return;
  if (!lifecycleInstalled) {
    lifecycleInstalled = true;
    app.on("before-quit", () => {
      quitting = true;
      stop();
    });
  }
  const executable = remoteDesktopExecutable();
  if (!executable) {
    desired = false;
    dialog.showErrorBox(
      "Remote desktop unavailable",
      "Build and bundle the native remote desktop helper first.",
    );
    return;
  }
  const child = NodeChildProcess.spawn(executable, [], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    env: { ...process.env, T3_REMOTE_EVENTS_FD: "3" },
  });
  helper = child;
  // Do not forward helper output: pairing credentials and screen/window titles
  // must never enter Electron logs or telemetry.
  child.stdout?.resume();
  child.stderr?.resume();
  child.stdin?.on("error", () => {}); // A crashed helper can close stdin before exit.
  const eventPipe = child.stdio[3];
  if (!(eventPipe instanceof NodeStream.Readable)) {
    helper = undefined;
    desired = false;
    child.kill();
    dialog.showErrorBox(
      "Remote desktop unavailable",
      "The private native control pipe could not be created.",
    );
    return;
  }
  const lines = NodeReadline.createInterface({ input: eventPipe });
  let startupFailed = false;
  let startupKillTimer: ReturnType<typeof setTimeout> | undefined;
  const startupTimer = setTimeout(() => {
    if (helper !== child || ready || stoppingHelper === child || !desired) return;
    startupFailed = true;
    child.kill("SIGTERM");
    startupKillTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    startupKillTimer.unref();
  }, 15_000);
  startupTimer.unref();
  lines.on("line", (line) => {
    if (helper !== child || stoppingHelper === child || startupFailed || !desired || quitting)
      return;
    if (!line.startsWith("T3RD ") || line.length > 256 * 1024) return;
    try {
      const event = JSON.parse(line.slice(5));
      if (event.type === "ready") {
        clearTimeout(startupTimer);
        ready = true;
        refreshRemoteDesktopMenu();
        hostFingerprint = typeof event.hostFingerprint === "string" ? event.hostFingerprint : null;
        nativeTransportReady = event.nativeTransportReady === true;
        nativePermissions = event.permissions !== undefined;
        if (healthyTimer === undefined) {
          healthyTimer = setTimeout(() => {
            healthyTimer = undefined;
            if (helper === child && ready && desired) restartAttempts = 0;
          }, 60_000);
          healthyTimer.unref();
        }
        for (const [setting, enabled] of Object.entries(settings)) {
          child.stdin?.write(`setting ${setting} ${enabled ? 1 : 0}\n`);
        }
      }
      if (event.type === "pairing" && typeof event.code === "string") {
        void dialog.showMessageBox({
          type: "info",
          title: "Pair remote desktop",
          message: `Pairing code: ${event.code}`,
          detail:
            "In T3 Code on your iPhone, open Remote Desktop, select this Mac, and enter this temporary code.",
        });
      }
      if (event.type === "error" && typeof event.message === "string") {
        dialog.showErrorBox("Remote desktop", event.message);
      }
      if (event.type === "native") {
        const decoded = decodeNativeEvent(event.event);
        if (decoded._tag === "Some") emitNative(decoded.value);
      }
    } catch {
      /* Ignore non-protocol output from the native engine. */
    }
  });
  // spawn errors also emit close. Use the same bounded recovery path and keep
  // arbitrary loader output out of dialogs/logs.
  child.once("error", () => {});
  child.once("close", () => {
    lines.close();
    clearTimeout(startupTimer);
    clearTimeout(startupKillTimer);
    if (helper !== child) return;
    const stopped = stoppingHelper === child;
    stoppingHelper = undefined;
    clearTimeout(healthyTimer);
    healthyTimer = undefined;
    helper = undefined;
    ready = false;
    refreshRemoteDesktopMenu();
    nativeTransportReady = false;
    hostFingerprint = null;
    emitNative({ type: "unavailable" });
    if (!desired || quitting) return;
    // Enable pressed while the old helper was stopping: wait for its actual
    // exit before binding another listener, rather than reviving the old one.
    if (stopped) {
      launch();
      return;
    }
    const delay = [250, 1000, 4000][restartAttempts++];
    if (delay === undefined) {
      desired = false;
      dialog.showErrorBox(
        "Remote desktop stopped",
        "The native host could not stay running after three retries. Check Screen Recording and Accessibility permissions, then enable it again.",
      );
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      launch();
    }, delay);
    restartTimer.unref();
  });
}

function refreshRemoteDesktopMenu() {
  const menu = Menu?.getApplicationMenu();
  const toggle = menu?.getMenuItemById("remote-desktop-toggle");
  if (toggle) toggle.checked = desired;
  const pair = menu?.getMenuItemById("remote-desktop-pair");
  if (pair) pair.enabled = ready;
}

export async function readRemoteDesktopSettings(): Promise<DesktopRemoteDesktopState> {
  if (managedHome) return readAgentState(managedHome);
  const executable = remoteDesktopExecutable();
  const permissions = executable ? await inspectRemoteDesktopPermissions(executable) : null;
  return {
    lifecycle,
    enabled: desired,
    ready,
    pairing,
    preferences: {
      clipboard: settings.clipboard ?? true,
      audio: settings.audio ?? true,
      "virtual-display": settings["virtual-display"] ?? true,
      "direct-wireless": settings["direct-wireless"] ?? false,
      remote: settings.remote ?? false,
      internet: settings.internet ?? false,
    },
    permissions,
  };
}

export async function changeRemoteDesktopSettings(
  command: DesktopRemoteDesktopCommand,
): Promise<void> {
  if (managedHome) {
    if (command.action === "permissions") {
      await permissionSetup?.(true);
      return;
    }
    if (command.action === "forget-devices") {
      const result = await dialog.showMessageBox({
        type: "warning",
        message: "Revoke every remote desktop device?",
        detail: "Active desktop sessions will disconnect. Each device must pair again.",
        buttons: ["Cancel", "Revoke devices"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return;
    }
    await changeAgentState(managedHome, command);
    return;
  }
  switch (command.action) {
    case "lifecycle":
      if (command.value === "persistent")
        throw new Error("Persistent hosting requires the packaged background host");
      lifecycle = command.value;
      persist();
      return;
    case "enable":
      start();
      return;
    case "disable":
      disable();
      return;
    case "permissions":
      await permissionSetup?.(true);
      return;
    case "setting":
      settings[command.key] = command.value;
      persist();
      if (ready) helper?.stdin?.write(`setting ${command.key} ${command.value ? 1 : 0}\n`);
      if ((command.key === "remote" || command.key === "internet") && !command.value)
        emitNative({ type: "unavailable" });
      return;
    case "pair":
      if (!ready) return;
      pairing = true;
      helper?.stdin?.write("pair\n");
      return;
    case "cancel-pairing":
      pairing = false;
      helper?.stdin?.write("cancel-pairing\n");
      return;
    case "forget-devices": {
      if (!ready) return;
      const result = await dialog.showMessageBox({
        type: "warning",
        message: "Revoke every remote desktop device?",
        detail: "Active desktop sessions will disconnect. Each device must pair again.",
        buttons: ["Cancel", "Revoke devices"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response === 1) helper?.stdin?.write("forget-devices\n");
    }
  }
}

export function remoteDesktopMenu(platform: string): MenuItemConstructorOptions[] {
  if (platform !== "darwin") return [];
  return [
    {
      label: "Remote Desktop",
      submenu: [
        { label: "Remote Desktop Settings…", click: () => showSettings?.() },
        { type: "separator" },
        {
          id: "remote-desktop-toggle",
          label: "Allow Remote Desktop",
          type: "checkbox",
          checked: desired,
          click: (item) => {
            if (item.checked) start();
            else disable();
          },
        },
        {
          id: "remote-desktop-pair",
          label: "Pair iPhone or iPad…",
          enabled: ready,
          click: () => {
            void changeRemoteDesktopSettings({ action: "pair" });
          },
        },
      ],
    },
  ];
}
