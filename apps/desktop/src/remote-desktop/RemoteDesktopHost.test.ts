// @effect-diagnostics nodeBuiltinImport:off -- Regression coverage for the imperative child-process and private pipe boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeStream from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Electron from "electron";
import type { RemoteDesktopNativeEvent } from "@t3tools/contracts";

vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
  existsSync: () => true,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), {
      isPackaged: false,
      getAppPath: () => "/fixture",
      commandLine: { getSwitchValue: () => "/fixture" },
    }),
    Menu: { getApplicationMenu: () => null },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
  };
});
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return {
    spawn: vi.fn(() => {
      const input = new PassThrough(),
        output = new PassThrough(),
        errors = new PassThrough(),
        events = new PassThrough();
      return Object.assign(new EventEmitter(), {
        stdin: input,
        stdout: output,
        stderr: errors,
        stdio: [input, output, errors, events],
        kill: vi.fn(),
      });
    }),
  };
});

import {
  observeRemoteDesktopNative,
  remoteDesktopMenu,
  changeRemoteDesktopSettings,
  sendRemoteDesktopNative,
} from "./RemoteDesktopHost.ts";

function action(label: string) {
  if (label === "Enable" || label === "Disconnect and disable") {
    void changeRemoteDesktopSettings({ action: label === "Enable" ? "enable" : "disable" });
    return;
  }
  const entries = remoteDesktopMenu("darwin")[0]?.submenu;
  if (!Array.isArray(entries)) throw new Error("Missing remote menu");
  const click = entries.find((item) => item.label === label)?.click;
  if (!click) throw new Error("Missing menu action");
  Reflect.apply(click, undefined, []);
}
function currentChild() {
  const child = vi.mocked(NodeChildProcess.spawn).mock.results.at(-1)?.value;
  if (!child) throw new Error("Missing fixture child");
  return child;
}
function reportReady(child: NodeChildProcess.ChildProcess) {
  const pipe = child.stdio[3];
  if (!(pipe instanceof NodeStream.Writable)) throw new Error("Missing event pipe");
  pipe.write(
    `T3RD ${JSON.stringify({ type: "ready", nativeTransportReady: true, hostFingerprint: "A".repeat(43) })}\n`,
  );
}
function hostStatus() {
  const received: RemoteDesktopNativeEvent[] = [];
  const unsubscribe = observeRemoteDesktopNative((event) => received.push(event));
  sendRemoteDesktopNative({
    requestId: "10000000-0000-4000-8000-000000000004",
    command: { type: "status" },
  });
  unsubscribe();
  const event = received.at(-1);
  if (event?.type !== "reply" || event.result.type !== "status")
    throw new Error("Missing status reply");
  return event.result.status;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  action("Disconnect and disable");
  for (const result of vi.mocked(NodeChildProcess.spawn).mock.results) {
    result.value?.emit("close", 0);
    result.value?.emit("exit", 0);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("native helper event isolation", () => {
  it("only accepts protocol events from the private pipe, never Sill's stdout", () => {
    const entries = remoteDesktopMenu("darwin")[0]?.submenu;
    if (!Array.isArray(entries)) throw new Error("Missing remote menu");
    action("Enable");
    const child = vi.mocked(NodeChildProcess.spawn).mock.results[0]?.value;
    if (!child?.stdout) throw new Error("Missing fixture child");
    const privatePipe = child.stdio[3];
    if (
      !(privatePipe instanceof NodeStream.Writable) ||
      !(child.stdout instanceof NodeStream.Writable)
    ) {
      throw new Error("Missing fixture pipe");
    }
    expect(vi.mocked(NodeChildProcess.spawn).mock.calls[0]?.[2]).toMatchObject({
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: { T3_REMOTE_EVENTS_FD: "3" },
    });
    const received: RemoteDesktopNativeEvent[] = [];
    const unsubscribe = observeRemoteDesktopNative((event) => received.push(event));
    const ready = JSON.stringify({
      type: "ready",
      nativeTransportReady: true,
      hostFingerprint: "A".repeat(43),
    });
    child.stdout.write(`T3RD ${ready}\n`);
    sendRemoteDesktopNative({
      requestId: "10000000-0000-4000-8000-000000000001",
      command: { type: "status" },
    });
    expect(received.at(-1)).toMatchObject({
      type: "reply",
      result: { type: "status", status: { enabled: false } },
    });
    privatePipe.write(`T3RD ${ready}\n`);
    sendRemoteDesktopNative({
      requestId: "10000000-0000-4000-8000-000000000002",
      command: { type: "status" },
    });
    expect(received.at(-1)).toMatchObject({
      type: "reply",
      result: { type: "status", status: { enabled: true } },
    });
    const closed = { type: "closed", sessionId: "10000000-0000-4000-8000-000000000003" };
    child.stdout.write(`T3RD ${JSON.stringify({ type: "native", event: closed })}\n`);
    expect(received.some((event) => event.type === "closed")).toBe(false);
    privatePipe.write(`T3RD ${JSON.stringify({ type: "native", event: closed })}\n`);
    expect(received.at(-1)).toEqual(closed);
    unsubscribe();
    child.emit("close", 0);
  });
  it("ignores readiness arriving after the user disables the host", async () => {
    action("Enable");
    const child = currentChild();
    action("Disconnect and disable");
    reportReady(child);
    expect(hostStatus().enabled).toBe(false);
    child.emit("close", 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(1);
  });
  it("retries crashes with a bounded backoff and then requires an explicit enable", async () => {
    action("Enable");
    for (const delay of [250, 1000, 4000]) {
      currentChild().emit("close", 1);
      expect(hostStatus().enabled).toBe(false);
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(4);
    currentChild().emit("close", 1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(4);
    expect(Electron.dialog.showErrorBox).toHaveBeenCalledTimes(1);
    action("Enable");
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(5);
  });
  it("cancels a queued restart when disabled and releases old session owners", async () => {
    action("Enable");
    reportReady(currentChild());
    const events: RemoteDesktopNativeEvent[] = [];
    const unsubscribe = observeRemoteDesktopNative((event) => events.push(event));
    currentChild().emit("close", 1);
    expect(events).toContainEqual({ type: "unavailable" });
    action("Disconnect and disable");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(1);
    expect(Electron.dialog.showErrorBox).not.toHaveBeenCalled();
    unsubscribe();
  });
  it("waits for a stopping process to exit before re-enabling and ignores its late ready event", () => {
    action("Enable");
    const previous = currentChild();
    action("Disconnect and disable");
    action("Enable");
    reportReady(previous);
    expect(hostStatus().enabled).toBe(false);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(1);
    previous.emit("close", 0);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(2);
    reportReady(currentChild());
    expect(hostStatus().enabled).toBe(true);
  });
  it("terminates a helper that never becomes ready, including one ignoring termination", async () => {
    action("Enable");
    const child = currentChild();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    reportReady(child);
    expect(hostStatus().enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null);
    await vi.advanceTimersByTimeAsync(250);
    expect(vi.mocked(NodeChildProcess.spawn)).toHaveBeenCalledTimes(2);
  });
});

it("shows the actual hosting state in a compact menu", () => {
  action("Enable");
  const entries = remoteDesktopMenu("darwin")[0]?.submenu;
  if (!Array.isArray(entries)) throw new Error("Missing menu");
  expect(entries.filter((entry) => entry.label).map((entry) => entry.label)).toEqual([
    "Remote Desktop Settings…",
    "Allow Remote Desktop",
    "Pair iPhone or iPad…",
  ]);
  expect(entries.find((entry) => entry.id === "remote-desktop-toggle")?.checked).toBe(true);
  action("Disconnect and disable");
  const stopped = remoteDesktopMenu("darwin")[0]?.submenu;
  if (!Array.isArray(stopped)) throw new Error("Missing menu");
  expect(stopped.find((entry) => entry.id === "remote-desktop-toggle")?.checked).toBe(false);
  expect(stopped.find((entry) => entry.id === "remote-desktop-pair")?.enabled).toBe(false);
});
