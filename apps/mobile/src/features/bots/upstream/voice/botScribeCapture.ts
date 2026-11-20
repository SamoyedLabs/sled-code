import { randomUUID } from "expo-crypto";
import type {
  VoiceRecorder,
  VoiceRecorderStatus,
  VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import { botElevenLabsScribeToken } from "./botElevenLabs";
import { ScribeRealtimeSession } from "./scribe-realtime";
import { speechNative } from "./speech-native";

/** Uses the same microphone ownership and draft commit path as the Code composer. */
export function createBotScribeCapture(onStatus: (status: VoiceRecorderStatus) => void) {
  type Capture = {
    uri: string;
    startedAt: number;
    level: number;
    failure: string | null;
    finishing: boolean;
    socket: ScribeRealtimeSession;
    listeners: { remove: () => void }[];
    limit?: ReturnType<typeof setTimeout>;
    settleNative?: () => void;
  };
  let active: Capture | null = null;

  function cleanup(capture: Capture) {
    if (active !== capture) return;
    active = null;
    if (capture.limit !== undefined) clearTimeout(capture.limit);
    for (const listener of capture.listeners) listener.remove();
    capture.socket.cancel();
    if (capture.startedAt) speechNative?.cancelCapture?.();
    capture.settleNative?.();
  }

  function fail(capture: Capture, message: string) {
    if (active !== capture) return;
    capture.failure = message;
    capture.settleNative?.();
    if (!capture.finishing)
      onStatus({ isFinished: false, hasError: true, error: message, url: capture.uri });
  }

  const recorder: VoiceRecorder = {
    get uri() {
      return active?.uri ?? null;
    },
    async prepareToRecordAsync() {
      if (!active || !speechNative?.startCapture) throw new Error("Dictation is unavailable.");
    },
    record({ forDuration }) {
      const capture = active;
      const native = speechNative;
      if (!capture || !native?.startCapture) throw new Error("Dictation is unavailable.");
      capture.startedAt = Date.now();
      capture.listeners.push(
        native.addListener("onCaptureAudio", ({ pcm }) => {
          if (active === capture) capture.socket.append(pcm);
        }),
        native.addListener("onCaptureLevel", ({ level }) => {
          if (active === capture) capture.level = level;
        }),
        native.addListener("onCaptureEnd", ({ error }) => {
          if (active !== capture) return;
          if (error) fail(capture, "The microphone was interrupted.");
          else capture.settleNative?.();
        }),
      );
      capture.limit = setTimeout(() => {
        if (active === capture && !capture.finishing)
          onStatus({ isFinished: true, hasError: false, error: null, url: capture.uri });
      }, forDuration * 1000);
      void native.startCapture("stream").catch(() => {
        fail(capture, "Could not open the microphone.");
      });
    },
    async stop() {
      const capture = active;
      if (!capture || !capture.startedAt || capture.failure) return;
      capture.finishing = true;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeout);
          delete capture.settleNative;
          resolve();
        };
        const timeout = setTimeout(finish, 2_000);
        capture.settleNative = finish;
        speechNative?.finishCapture?.();
      });
    },
  };
  const transcriber: VoiceTranscriber = {
    async prepare({ signal }) {
      const token = await botElevenLabsScribeToken(signal);
      signal.throwIfAborted();
      const uri = `sled-scribe://${randomUUID()}`;
      const capture: Capture = {
        uri,
        startedAt: 0,
        level: 0,
        failure: null,
        finishing: false,
        listeners: [],
        socket: new ScribeRealtimeSession({
          token,
          onText: () => {},
          onFailure: () => fail(capture, "ElevenLabs could not recognize this recording."),
        }),
      };
      active = capture;
      signal.addEventListener("abort", () => cleanup(capture), { once: true });
      return {
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        async transcribe(recording, { signal: finishingSignal }) {
          try {
            if (recording !== uri || active !== capture)
              throw new Error("That dictation has closed.");
            if (!capture.finishing) await recorder.stop();
            if (capture.failure) throw new Error(capture.failure);
            await capture.socket.finish();
            finishingSignal.throwIfAborted();
            if (capture.failure) throw new Error(capture.failure);
            return capture.socket.text.trim();
          } finally {
            cleanup(capture);
          }
        },
      };
    },
  };
  return {
    recorder,
    transcriber,
    sample: () => {
      const capture = active;
      if (!capture?.startedAt) return null;
      return { durationMillis: Date.now() - capture.startedAt, metering: -60 + capture.level * 60 };
    },
    release: (uri: string) => {
      if (!uri.startsWith("sled-scribe://")) return false;
      if (active?.uri === uri) cleanup(active);
      return true;
    },
  };
}
