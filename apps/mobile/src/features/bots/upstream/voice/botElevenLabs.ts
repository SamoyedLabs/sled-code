import * as SecureStore from "expo-secure-store";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";
import {
  ELEVENLABS_SAMPLE_RATE,
  SPEECH_MODELS,
  elevenLabsSpeech,
  listElevenLabsVoices,
  scribeToken,
  testElevenLabsKey,
  type ElevenLabsSpeechModelId,
} from "./elevenlabs";

const KEY = "sled.bots.elevenlabs.v1";
const Saved = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  voice: Schema.NullOr(Schema.String),
  model: Schema.Literals(Object.keys(SPEECH_MODELS) as ElevenLabsSpeechModelId[]),
  readReplies: Schema.Boolean,
});
type Saved = typeof Saved.Type;
type Settings = Omit<Saved, "key">;
const decodeSaved = Schema.decodeUnknownOption(Saved);
const listeners = new Set<() => void>();
let saved: Saved | null = null;
let settings: Settings | null = null;
let loading: Promise<void> | undefined;

function publish(next: Saved | null) {
  saved = next;
  settings = next ? { voice: next.voice, model: next.model, readReplies: next.readReplies } : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load() {
  return (loading ??= (async () => {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return;
    const decoded = decodeSaved(JSON.parse(raw));
    if (decoded._tag === "Some") publish(decoded.value);
  })().catch(() => undefined));
}

export function getBotElevenLabs() {
  return settings;
}

export function useBotElevenLabs() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the API key from OS secure storage.
  useEffect(() => void load(), []);
  return useSyncExternalStore(subscribe, getBotElevenLabs, getBotElevenLabs);
}

export async function connectBotElevenLabs(input: string) {
  await load();
  const key = input.trim();
  if (!key || key.length > 2048 || /[\s\x00-\x1f\x7f]/.test(key))
    throw new Error("Enter an ElevenLabs API key.");
  const voices = await testElevenLabsKey(key);
  const next: Saved = {
    key,
    voice: voices[0]?.id ?? null,
    model: "elevenlabs-flash-v2.5",
    readReplies: false,
  };
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  publish(next);
  return voices;
}

export async function botElevenLabsVoices() {
  await load();
  return saved ? listElevenLabsVoices(saved.key) : [];
}

export async function saveBotElevenLabsSettings(next: Settings) {
  await load();
  if (!saved) return;
  const candidate = { ...saved, ...next };
  await SecureStore.setItemAsync(KEY, JSON.stringify(candidate));
  publish(candidate);
}

export async function removeBotElevenLabs() {
  await load();
  await SecureStore.deleteItemAsync(KEY);
  publish(null);
}

export function botElevenLabsSynthesizer(explicitPreview = false) {
  const connection = saved;
  const voice = connection?.voice;
  if (!connection || !voice || (!explicitPreview && !connection.readReplies)) return null;
  return async (text: string, signal: AbortSignal) => ({
    pcm: await elevenLabsSpeech(connection.key, voice, connection.model, text, signal),
    sampleRate: ELEVENLABS_SAMPLE_RATE,
  });
}

export async function botElevenLabsScribeToken(signal: AbortSignal) {
  await load();
  if (!saved) throw new Error("Connect ElevenLabs in Bot voice settings.");
  return scribeToken(saved.key, signal);
}
