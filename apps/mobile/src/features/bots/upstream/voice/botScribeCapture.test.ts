import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => {
  const listeners = new Map<string, (input: never) => void>();
  return {
    send: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn(),
    startCapture: vi.fn(async () => {}),
    cancelCapture: vi.fn(),
    finishCapture: () => listeners.get("onCaptureEnd")?.({} as never),
    addListener: (type: string, listener: (input: never) => void) => {
      listeners.set(type, listener);
      return { remove: () => listeners.delete(type) };
    },
    audio: () => listeners.get("onCaptureAudio")?.({ pcm: "AAAA" } as never),
    listeners,
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: () => "voice-fixture" }));
vi.mock("./botElevenLabs", () => ({ botElevenLabsScribeToken: async () => "synthetic-token" }));
vi.mock("./speech-native", () => ({ speechNative: native }));
vi.mock("./scribe-realtime", () => ({
  ScribeRealtimeSession: class {
    text = "Synthetic transcript";
    append = native.send;
    finish = native.finish;
    cancel = native.cancel;
  },
}));

import { createBotScribeCapture } from "./botScribeCapture";

afterEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
});

describe("Scribe composer capture", () => {
  it("streams a native frame and commits text only for the recorder that owns it", async () => {
    const capture = createBotScribeCapture(vi.fn());
    const { signal } = new AbortController();
    const prepared = await capture.transcriber.prepare({ signal });
    const ownUri = capture.recorder.uri!;
    await capture.recorder.prepareToRecordAsync();
    capture.recorder.record({ forDuration: 60 });

    native.audio();
    expect(native.startCapture).toHaveBeenCalledWith("stream");
    expect(native.send).toHaveBeenCalledWith("AAAA");
    await capture.recorder.stop();
    await expect(prepared.transcribe(ownUri, { signal })).resolves.toBe("Synthetic transcript");
    expect(native.finish).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledOnce();
    expect(capture.recorder.uri).toBeNull();
    expect(native.listeners.size).toBe(0);
  });

  it("drops microphone listeners and late audio when the draft is canceled", async () => {
    const capture = createBotScribeCapture(vi.fn());
    const controller = new AbortController();
    const prepared = await capture.transcriber.prepare({ signal: controller.signal });
    const ownUri = capture.recorder.uri!;
    await capture.recorder.prepareToRecordAsync();
    capture.recorder.record({ forDuration: 60 });
    controller.abort();

    native.audio();
    expect(native.send).not.toHaveBeenCalled();
    expect(native.cancelCapture).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledOnce();
    await expect(prepared.transcribe(ownUri, { signal: controller.signal })).rejects.toThrow();
    expect(native.finish).not.toHaveBeenCalled();
  });
});
