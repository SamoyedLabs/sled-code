import { OPENBOT_LIVE_VOICES } from "@t3tools/contracts";
import { requireOptionalNativeModule, type NativeModule } from "expo";
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

type Voice = (typeof OPENBOT_LIVE_VOICES)[number];
type Settings = { enabled: boolean; voice: Voice | null };
type NativeState = {
  id: string;
  state: "connected" | "reconnecting" | "failed" | "thinking" | "listening" | "speaking";
};
declare class VoiceNative extends NativeModule<{ onBotVoiceState: (event: NativeState) => void }> {
  createBotVoiceOffer(id: string): Promise<string>;
  acceptBotVoiceAnswer(id: string, sdp: string): Promise<void>;
  setBotVoiceMuted(id: string, muted: boolean): Promise<void>;
  closeBotVoice(id: string): Promise<void>;
  interruptBotVoice(id: string): Promise<void>;
}

const native = requireOptionalNativeModule<VoiceNative>("T3RemoteDesktop");
export const botGptVoiceNative =
  native &&
  typeof native.createBotVoiceOffer === "function" &&
  typeof native.interruptBotVoice === "function"
    ? native
    : null;
const KEY = "bots.speech.gptLive.v1";
const defaults: Settings = { enabled: false, voice: null };
const listeners = new Set<() => void>();
let settings: Settings | undefined;

function read(): Settings {
  if (settings) return settings;
  try {
    const value: unknown = JSON.parse(Storage.getItemSync(KEY) ?? "null");
    if (value && typeof value === "object" && "enabled" in value && "voice" in value) {
      const voice = OPENBOT_LIVE_VOICES.find((name) => name === value.voice) ?? null;
      return (settings = { enabled: value.enabled === true, voice });
    }
  } catch {
    // The default is disabled. An unreadable preference cannot open the microphone.
  }
  return (settings = defaults);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBotGptVoiceSettings() {
  return useSyncExternalStore(subscribe, read, () => defaults);
}

export function saveBotGptVoiceSettings(next: Settings) {
  Storage.setItemSync(KEY, JSON.stringify(next));
  settings = next;
  for (const listener of listeners) listener();
}
