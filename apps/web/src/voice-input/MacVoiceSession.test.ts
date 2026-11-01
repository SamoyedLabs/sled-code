import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DesktopVoiceInputBridge, DesktopVoiceInputPhase } from "@t3tools/contracts";
import { MacVoiceSession } from "./MacVoiceSession";

function setup() {
  const result = Promise.withResolvers<{ text: string; locale: string }>();
  let notify: ((phase: DesktopVoiceInputPhase) => void) | undefined;
  let requestId = "";
  const bridge: DesktopVoiceInputBridge = {
    available: async () => true,
    record: ({ id }) => {
      requestId = id;
      return result.promise;
    },
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onPhase: (listener) => {
      notify = listener;
      return () => {
        notify = undefined;
      };
    },
  };
  vi.stubGlobal("window", { desktopBridge: { getSystemLocale: () => "en-US" } });
  let draft = {
    ownerKey: "thread-a",
    text: "Please help",
    selection: { start: 11, end: 11 },
    revision: 0,
  };
  const commit = vi.fn();
  const session = new MacVoiceSession(bridge, () => draft, commit);
  const disconnect = session.connect("thread-a");
  return {
    session,
    result,
    bridge,
    commit,
    disconnect,
    phase: (phase: DesktopVoiceInputPhase["phase"], level?: number) =>
      notify?.({ id: requestId, phase, ...(level !== undefined ? { level } : {}) }),
    edit: (text: string, ownerKey = "thread-a") => {
      draft = { ...draft, text, ownerKey };
      session.observeDraft();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it("records, stops, and inserts a transcript with English spacing into the captured selection", async () => {
  const test = setup();
  await Promise.resolve();
  const operation = test.session.start();
  expect(test.session.getSnapshot().phase).toBe("preparing");
  test.phase("recording");
  const notifyState = vi.fn();
  const notifyAudio = vi.fn();
  const unsubscribeState = test.session.subscribe(notifyState);
  const unsubscribeAudio = test.session.audio.subscribe(notifyAudio);
  test.phase("recording", 0.25);
  test.phase("recording", 0.8);
  expect(test.session.audio.getSnapshot().slice(-2)).toEqual([0.25, 0.8]);
  expect(notifyAudio).toHaveBeenCalledTimes(2);
  expect(notifyState).not.toHaveBeenCalled();
  test.session.stop();
  test.phase("recording", 0.9);
  expect(test.session.audio.getSnapshot().every((level) => level === 0)).toBe(true);
  unsubscribeState();
  unsubscribeAudio();
  expect(test.bridge.stop).toHaveBeenCalledOnce();
  expect(test.session.getSnapshot().phase).toBe("transcribing");
  test.result.resolve({ text: "with this task.", locale: "en-US" });
  await operation;
  expect(test.commit).toHaveBeenCalledWith("Please help with this task.", 27);
  expect(test.session.getSnapshot().phase).toBe("idle");
  test.disconnect();
});

it.each(["edit", "undo", "switch", "cancel", "navigate", "empty", "error"] as const)(
  "protects the draft after %s",
  async (change) => {
    const test = setup();
    await Promise.resolve();
    const operation = test.session.start();
    test.phase("recording");
    if (change === "edit" || change === "undo") test.edit("Different draft");
    if (change === "undo") test.edit("Please help");
    if (change === "switch") test.edit("Please help", "thread-b");
    if (change === "cancel") test.session.cancel();
    if (change === "navigate") test.disconnect();
    if (change === "error") test.result.reject(new Error("Microphone permission denied"));
    else test.result.resolve({ text: change === "empty" ? "  " : "new words", locale: "en-US" });
    await operation;
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.session.getSnapshot().phase).toBe(
      change === "cancel" || change === "navigate" ? "idle" : "error",
    );
    if (change === "cancel" || change === "navigate")
      expect(test.bridge.cancel).toHaveBeenCalledOnce();
    test.disconnect();
  },
);
