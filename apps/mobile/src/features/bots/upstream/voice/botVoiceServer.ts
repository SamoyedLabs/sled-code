import { fetch } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";
import {
  decodeVoiceServerWav,
  encodeVoiceServerWav,
  OPENAI_VOICES,
  VOICE_SERVER_VOICE_PATHS,
  voiceServerAddress,
  voiceServerKey,
  voiceServerModelLists,
  voiceServerVoiceNames,
  type VoiceServerModels,
  type VoiceServerRoutes,
} from "./botVoiceServerWire";

const KEY = "sled.bots.voice-server.v1";
const LIST_BYTES = 1024 * 1024;
const AUDIO_BYTES = 32 * 1024 * 1024;
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Saved = Schema.Struct({
  address: Schema.String,
  key: Schema.String,
  routes: Schema.Struct({
    dictation: Schema.Boolean,
    speech: Schema.Boolean,
    transcriptionModel: Schema.NullOr(Name),
    speechModel: Schema.NullOr(Name),
    voice: Schema.NullOr(Name),
  }),
});
type Saved = typeof Saved.Type;
const decodeSaved = Schema.decodeUnknownOption(Saved);
type Public = { address: string; hasKey: boolean; routes: VoiceServerRoutes };

let saved: Saved | null = null;
let snapshot: Public | null = null;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
function publish(value: Saved | null) {
  saved = value;
  snapshot = value
    ? { address: value.address, hasKey: Boolean(value.key), routes: value.routes }
    : null;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function load() {
  return (loading ??= (async () => {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return;
    const decoded = decodeSaved(JSON.parse(raw));
    if (
      decoded._tag === "Some" &&
      voiceServerAddress(decoded.value.address) &&
      voiceServerKey(decoded.value.key)
    )
      publish(decoded.value);
  })().catch(() => undefined));
}

export function getBotVoiceServer() {
  return snapshot;
}
export function useBotVoiceServer() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load credentials only from the OS keychain.
  useEffect(() => void load(), []);
  return useSyncExternalStore(subscribe, getBotVoiceServer, getBotVoiceServer);
}

async function target(address: string, suppliedKey: string) {
  const url = voiceServerAddress(address);
  if (!url) throw new Error("Enter an HTTP or HTTPS voice server address.");
  if (!voiceServerKey(suppliedKey)) throw new Error("Enter a valid API key.");
  await load();
  const keepKey = saved && voiceServerAddress(saved.address)?.origin === url.origin;
  return { address: url.toString(), key: suppliedKey || (keepKey ? saved?.key : "") || "" };
}

export async function saveBotVoiceServer(address: string, key: string, routes: VoiceServerRoutes) {
  const candidate = { ...(await target(address, key)), routes };
  const decoded = decodeSaved(candidate);
  if (decoded._tag !== "Some") throw new Error("Check the selected models and voice.");
  await SecureStore.setItemAsync(KEY, JSON.stringify(decoded.value));
  publish(decoded.value);
}

export async function removeBotVoiceServer() {
  await load();
  await SecureStore.deleteItemAsync(KEY);
  publish(null);
}

type VoiceRequest = {
  method: "GET" | "POST";
  body?: FormData | string;
  contentType?: string;
};

async function exchange(
  connection: Pick<Saved, "address" | "key">,
  path: string,
  request: VoiceRequest,
  timeout: number,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const url = voiceServerAddress(connection.address);
  if (!url) throw new Error("The voice server address is invalid.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      body: request.body,
      headers: {
        Accept: "*/*",
        ...(request.contentType ? { "Content-Type": request.contentType } : {}),
        ...(connection.key ? { Authorization: `Bearer ${connection.key}` } : {}),
      },
      redirect: "manual",
      signal: controller.signal,
    }).catch(() => {
      throw new Error(
        controller.signal.aborted
          ? "The voice server request was interrupted."
          : "Could not reach the voice server.",
      );
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("The voice server returned a redirect. Enter its final address.");
    if (response.status === 401 || response.status === 403)
      throw new Error("The voice server refused the API key.");
    if (!response.ok) throw new Error(`The voice server returned HTTP ${response.status}.`);
    if (Number(response.headers.get("content-length")) > maxBytes || !response.body)
      throw new Error("The voice server response is too large or empty.");
    const reader = response.body.getReader();
    try {
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const data = await reader.read();
        if (data.done) break;
        size += data.value.byteLength;
        if (size > maxBytes) throw new Error("The voice server response is too large.");
        parts.push(data.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    } catch {
      throw new Error("Could not read the voice server response.");
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The voice server returned an invalid response.");
  }
}

export async function probeBotVoiceServer(
  address: string,
  key: string,
): Promise<VoiceServerModels> {
  const connection = await target(address, key);
  const list = async (path: string) =>
    json(await exchange(connection, path, { method: "GET" }, 8000, LIST_BYTES));
  const models = voiceServerModelLists(await list("models"));
  if (!models) throw new Error("The voice server did not return a model list.");
  if (!models.speech.length) return { ...models, voices: [] };
  for (const path of VOICE_SERVER_VOICE_PATHS) {
    const voices = await list(path).then(voiceServerVoiceNames, () => []);
    if (voices.length) return { ...models, voices };
  }
  return { ...models, voices: [...OPENAI_VOICES] };
}

export function botVoiceServerTranscriber() {
  const connection = saved;
  const model = connection?.routes.dictation && connection.routes.transcriptionModel;
  if (!connection || !model) return null;
  return async (uri: string, signal: AbortSignal) => {
    const file = new File(uri);
    if (!file.exists || !file.size || file.size > AUDIO_BYTES)
      throw new Error("The recording is unavailable or too large.");
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("model", model);
    body.append("response_format", "json");
    const raw = json(
      await exchange(
        connection,
        "audio/transcriptions",
        { method: "POST", body },
        120_000,
        LIST_BYTES,
        signal,
      ),
    );
    if (typeof raw !== "object" || !raw || !("text" in raw) || typeof raw.text !== "string")
      throw new Error("The voice server did not return a transcript.");
    return raw.text.trim();
  };
}

export function botVoiceServerSynthesizer() {
  const connection = saved;
  const model = connection?.routes.speech && connection.routes.speechModel;
  const voice = connection?.routes.voice;
  if (!connection || !model || !voice) return null;
  return async (input: string, signal: AbortSignal) => {
    const request = {
      method: "POST" as const,
      contentType: "application/json",
      body: JSON.stringify({ model, input, voice, response_format: "wav" }),
    };
    const bytes = await exchange(connection, "audio/speech", request, 120_000, AUDIO_BYTES, signal);
    const audio = decodeVoiceServerWav(bytes);
    if (!audio) throw new Error("The voice server did not return supported WAV audio.");
    return audio;
  };
}

export async function transcribeBotVoiceServerPcm(
  chunks: readonly Uint8Array[],
  size: number,
  signal: AbortSignal,
) {
  const transcribe = botVoiceServerTranscriber();
  if (!transcribe || signal.aborted) return "";
  const pcm = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const recording = new File(Paths.cache, `sled-bot-voice-${randomUUID()}.wav`);
  try {
    recording.write(encodeVoiceServerWav(pcm, 16000));
    return await transcribe(recording.uri, signal);
  } finally {
    try {
      if (recording.exists) recording.delete();
    } catch {
      // The operating system can still clear this app-owned cache file.
    }
  }
}
