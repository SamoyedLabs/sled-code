import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const player = vi.hoisted(() => {
  const listeners = new Map<string, (event: { id: string }) => void>();
  return {
    listeners,
    speak: vi.fn(),
    stop: vi.fn(),
    addListener: vi.fn((name: string, listener: (event: { id: string }) => void) => {
      listeners.set(name, listener);
      return { remove: () => listeners.delete(name) };
    }),
  };
});
vi.mock("react", () => ({
  useLayoutEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("expo-file-system", () => ({
  Directory: class {
    uri = "file:///synthetic-model";
  },
}));
vi.mock("expo-sqlite/kv-store", () => ({ default: { getItemSync: () => null } }));
vi.mock("../../../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("./verified-speech-model", () => ({
  hasVerifiedSpeechModel: () => true,
  verifySpeechFiles: async () => {},
}));
vi.mock("./botElevenLabs", () => ({
  botElevenLabsSynthesizer: () => null,
  useBotElevenLabs: () => null,
}));
vi.mock("./botVoiceServer", () => ({
  botVoiceServerSynthesizer: () => null,
  useBotVoiceServer: () => null,
}));
vi.mock("./speech-native", () => ({
  speechNative: {
    ...player,
    modelRoot: () => "file:///synthetic-voice",
    load: async () => {},
  },
}));
import { useBotMessageReading } from "./BotMessageReading";

describe("streamed bot reply reading", () => {
  beforeEach(() => {
    player.speak.mockClear();
    player.stop.mockClear();
  });

  it("synthesizes fixed sentences before completion and waits for playback of the final part", async () => {
    const onStart = vi.fn();
    const onDone = vi.fn();
    const reading = useBotMessageReading("reply");
    const stream = reading.stream("message-1", { onStart, onDone })!;
    stream.update("First sentence.", false);
    expect(player.speak).not.toHaveBeenCalled();
    stream.update("First sentence. Here is a", false);
    await vi.waitFor(() => expect(player.speak).toHaveBeenCalledTimes(1));
    const first = player.speak.mock.calls[0]!;
    expect(first[1]).toBe("First sentence.");
    player.listeners.get("onSpeechStart")?.({ id: first[0] });
    player.listeners.get("onSpeechDone")?.({ id: first[0] });
    expect(onStart).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    stream.update("First sentence. Here is a second sentence.", true);
    expect(player.speak).toHaveBeenCalledTimes(2);
    const last = player.speak.mock.calls[1]!;
    expect(last[1]).toBe("Here is a second sentence.");
    player.listeners.get("onSpeechDone")?.({ id: last[0] });
    expect(onDone).toHaveBeenCalledOnce();
    expect(player.listeners.size).toBe(0);
  });

  it("drops later chunks and native completion after the owner stops", async () => {
    const onDone = vi.fn();
    const reading = useBotMessageReading("cancelled");
    const stream = reading.stream("message-2", { onDone })!;
    stream.update("First sentence. More", false);
    await vi.waitFor(() => expect(player.speak).toHaveBeenCalledTimes(1));
    const lateDone = player.listeners.get("onSpeechDone");
    reading.stop();
    stream.update("First sentence. More text.", true);
    lateDone?.({ id: player.speak.mock.calls[0]![0] });
    expect(player.stop).toHaveBeenCalledOnce();
    expect(player.speak).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
