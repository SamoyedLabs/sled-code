import { Directory } from "expo-file-system";
import { hasVerifiedSpeechModel, verifySpeechFiles } from "./verified-speech-model";
import Storage from "expo-sqlite/kv-store";
import { useLayoutEffect, useSyncExternalStore } from "react";
import * as Dialog from "../../../../components/ui/Dialog";
import { speechLanguageOf } from "./speech-language";
import {
  SUPERTONIC_DENOISING_STEPS,
  SUPERTONIC_MODEL_DIRECTORY,
  SUPERTONIC_MODEL_FILES,
} from "./speech-models";
import { speechNative } from "./speech-native";
import { liveSpeechParts } from "./speech-parts";
import { speechTextFromMarkdown } from "./speech-text";
import { botElevenLabsSynthesizer, useBotElevenLabs } from "./botElevenLabs";
import { botVoiceServerSynthesizer, useBotVoiceServer } from "./botVoiceServer";
import { SPEECH_LANGUAGES, type SpeechLanguage } from "./speech-languages";

type Reading = {
  scope: string;
  messageId: string;
  controller: AbortController;
  phase: "preparing" | "playing";
  progress: number;
};
export const BOT_SPEECH_VOICES = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
] as const;
export type BotSpeechVoice = (typeof BOT_SPEECH_VOICES)[number];
const VOICE_PREF = "bots.speech.supertonicVoice.v1";
const DOWNLOAD_MODEL = "download-supertonic";
const SPEED_PREF = "bots.speech.speed.v1";
export const BOT_SPEECH_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type BotSpeechSpeed = (typeof BOT_SPEECH_SPEEDS)[number];

export function getBotSpeechSpeed(): BotSpeechSpeed {
  try {
    const stored = Storage.getItemSync(SPEED_PREF);
    return BOT_SPEECH_SPEEDS.find((speed) => String(speed) === stored) ?? 1;
  } catch {
    return 1;
  }
}

export function saveBotSpeechSpeed(speed: BotSpeechSpeed) {
  Storage.setItemSync(SPEED_PREF, String(speed));
  speechNative?.setSpeed?.(speed);
}

export function getBotSpeechVoice(): BotSpeechVoice {
  try {
    const stored = Storage.getItemSync(VOICE_PREF);
    return BOT_SPEECH_VOICES.find((voice) => voice === stored) ?? "F1";
  } catch {
    return "F1";
  }
}

export function saveBotSpeechVoice(voice: BotSpeechVoice) {
  Storage.setItemSync(VOICE_PREF, voice);
}

let active: Reading | null = null;
let sequence = 0;
const subscribers = new Set<() => void>();

function publish(next: Reading | null) {
  active = next;
  for (const subscriber of subscribers) subscriber();
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useBotMessageReading(scope: string) {
  useBotVoiceServer();
  useBotElevenLabs();
  const current = useSyncExternalStore(subscribe, () => active);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Stop the native playback and any model download when this conversation unmounts.
  useLayoutEffect(
    () => () => {
      if (active?.scope === scope) stop();
    },
    [scope],
  );
  return {
    available: speechNative !== null,
    messageId: current?.scope === scope ? current.messageId : null,
    phase: current?.scope === scope ? current.phase : null,
    progress: current?.scope === scope ? current.progress : 0,
    stop: () => {
      if (active?.scope === scope) stop();
    },
    toggle: (messageId: string, text: string, voice?: BotSpeechVoice) =>
      toggle(scope, messageId, text, voice),
    previewElevenLabs: (messageId: string, text: string) => {
      if (active?.scope === scope && active.messageId === messageId) {
        stop();
        return;
      }
      const synthesize = botElevenLabsSynthesizer(true);
      if (synthesize)
        startReading(scope, messageId, getBotSpeechVoice(), {}, false, synthesize)?.update(
          text,
          true,
        );
    },
    stream: (messageId: string, handlers: StreamHandlers) =>
      startReading(scope, messageId, getBotSpeechVoice(), handlers),
    toggleModelDownload: () => toggle(scope, DOWNLOAD_MODEL, "", "F1"),
    downloadingModel: current?.scope === scope && current.messageId === DOWNLOAD_MODEL,
  };
}

function stop() {
  active?.controller.abort();
  speechNative?.stop();
  publish(null);
}

const TOTAL_BYTES = SUPERTONIC_MODEL_FILES.reduce((total, item) => total + item.bytes, 0);
export const BOT_SPEECH_MODEL_SIZE = `${(TOTAL_BYTES / 1024 ** 2).toFixed(1)} MB`;

export function isBotSpeechModelReady() {
  return speechNative
    ? hasVerifiedSpeechModel(
        new Directory(speechNative.modelRoot(), SUPERTONIC_MODEL_DIRECTORY),
        SUPERTONIC_MODEL_FILES,
      )
    : false;
}

let priorPlayback = Promise.resolve();
export function removeBotSpeechModel() {
  const native = speechNative;
  if (!native) return Promise.resolve();
  if (active) stop();
  const remove = async () => {
    await native.unload();
    const directory = new Directory(native.modelRoot(), SUPERTONIC_MODEL_DIRECTORY);
    if (directory.exists) directory.delete();
  };
  const operation = priorPlayback.then(remove);
  priorPlayback = operation.catch(() => undefined);
  return operation;
}

type StreamHandlers = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: () => void;
};

function toggle(scope: string, messageId: string, text: string, voice?: BotSpeechVoice) {
  if (active?.scope === scope && active.messageId === messageId) {
    stop();
    return;
  }
  if (messageId !== DOWNLOAD_MODEL && !liveSpeechParts(text, 500).length) return;
  startReading(scope, messageId, voice ?? getBotSpeechVoice(), {}, voice !== undefined)?.update(
    text,
    true,
  );
}

function startReading(
  scope: string,
  messageId: string,
  voice: BotSpeechVoice,
  handlers: StreamHandlers = {},
  forceLocal = false,
  voiceOverride?: NonNullable<ReturnType<typeof botElevenLabsSynthesizer>>,
) {
  const native = speechNative;
  if (!native) return null;
  if (active) stop();
  const controller = new AbortController();
  const { signal } = controller;
  const reading: Reading = { scope, messageId, controller, phase: "preparing", progress: 0 };
  const id = String(++sequence);
  const downloadOnly = messageId === DOWNLOAD_MODEL;
  if (!downloadOnly) native.setSpeed?.(getBotSpeechSpeed());
  const synthesize =
    voiceOverride ??
    (!downloadOnly && !forceLocal
      ? (botElevenLabsSynthesizer() ?? botVoiceServerSynthesizer())
      : null);
  const speaker = BOT_SPEECH_VOICES.indexOf(voice);
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0];
  let language: SpeechLanguage = SPEECH_LANGUAGES.find((item) => item === locale) ?? "en";
  let ready = false;
  let pumping = false;
  let started = false;
  let complete = false;
  let markdownSoFar = "";
  let nextPart = 0;
  let lastPlayed = -1;
  const parts: string[] = [];
  publish(reading);

  const finish = (error: boolean) => {
    if (active?.controller !== controller || signal.aborted) return;
    if (error) stop();
    else {
      controller.abort();
      publish(null);
    }
    if (!error) handlers.onDone?.();
    else if (handlers.onError) handlers.onError();
    else
      Dialog.alert(
        downloadOnly ? "Could not download the voice model" : "Could not read this message aloud",
        "Check the speech download and try again.",
      );
  };
  const done = () => {
    if (complete && lastPlayed === parts.length - 1) finish(false);
  };
  const pump = async () => {
    if (!ready || pumping || signal.aborted) return;
    pumping = true;
    try {
      while (!signal.aborted && nextPart < parts.length) {
        const index = nextPart++;
        const part = parts[index]!;
        if (synthesize) {
          const audio = await synthesize(part, signal);
          if (!signal.aborted) native.playPcm(`${id}:${index}`, audio.pcm, audio.sampleRate);
          continue;
        }
        const detected = index === 0 ? speechTextFromMarkdown(markdownSoFar) : part;
        language = speechLanguageOf(detected, language) ?? language;
        native.speak(`${id}:${index}`, part, language, speaker, SUPERTONIC_DENOISING_STEPS);
      }
    } catch {
      finish(true);
    } finally {
      pumping = false;
    }
  };

  const prepare = async () => {
    if (signal.aborted) return;
    const directory = new Directory(native.modelRoot(), SUPERTONIC_MODEL_DIRECTORY);
    try {
      if (!synthesize) {
        await verifySpeechFiles(directory, SUPERTONIC_MODEL_FILES, signal, (progress) => {
          const percent = Math.floor(progress * 100);
          if (active?.controller === controller && percent > active.progress)
            publish({ ...active, progress: percent });
        });
        if (signal.aborted) return;
        if (downloadOnly) return finish(false);
        await native.load(directory.uri, 4);
        if (signal.aborted) return;
      }
      const listeners = [
        native.addListener("onSpeechStart", ({ id: part }) => {
          if (!part.startsWith(`${id}:`) || signal.aborted) return;
          if (active?.controller === controller && active.phase !== "playing") {
            publish({ ...reading, phase: "playing", progress: 100 });
            handlers.onStart?.();
          }
        }),
        native.addListener("onSpeechDone", ({ id: part }) => {
          if (!part.startsWith(`${id}:`) || signal.aborted) return;
          lastPlayed = Number(part.slice(id.length + 1));
          done();
        }),
        native.addListener("onSpeechError", ({ id: part }) => {
          if (part.startsWith(`${id}:`)) finish(true);
        }),
      ];
      signal.addEventListener("abort", () => listeners.forEach((item) => item.remove()), {
        once: true,
      });
      ready = true;
      void pump();
    } catch {
      finish(true);
    }
  };

  return {
    update(markdown: string, isComplete: boolean) {
      if (complete || signal.aborted) return;
      markdownSoFar = markdown;
      const next = liveSpeechParts(markdown, 500);
      // The last part can still grow until more text or the end of the reply arrives.
      const fixed = isComplete ? next : next.slice(0, -1);
      parts.push(...fixed.slice(parts.length));
      complete = isComplete;
      if (!started && (parts.length || downloadOnly)) {
        started = true;
        priorPlayback = priorPlayback.then(prepare, prepare);
      }
      if (downloadOnly) return;
      void pump();
      done();
    },
  };
}
