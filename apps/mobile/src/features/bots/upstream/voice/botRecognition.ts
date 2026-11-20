import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import * as Device from "expo-device";
import { Directory } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { getBotElevenLabs, useBotElevenLabs } from "./botElevenLabs";
import { speechNative } from "./speech-native";
import { botVoiceServerTranscriber, getBotVoiceServer, useBotVoiceServer } from "./botVoiceServer";
import {
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_MODEL_FILES,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_FILES,
  QWEN3_ASR_MODEL_DIRECTORY,
  QWEN3_ASR_MODEL_FILES,
} from "./speech-models";
import { hasVerifiedSpeechModel, verifySpeechFiles } from "./verified-speech-model";

export const BOT_RECOGNITION_MODELS = [
  {
    id: "parakeet",
    name: "Parakeet v3",
    detail: "25 European languages",
    directory: PARAKEET_MODEL_DIRECTORY,
    files: PARAKEET_MODEL_FILES,
  },
  {
    id: "parakeet-unified",
    name: "Parakeet Unified",
    detail: "English",
    directory: PARAKEET_UNIFIED_MODEL_DIRECTORY,
    files: PARAKEET_UNIFIED_MODEL_FILES,
  },
  {
    id: "qwen3-asr",
    name: "Qwen3-ASR",
    detail: "30 languages, including mixed Chinese and English",
    directory: QWEN3_ASR_MODEL_DIRECTORY,
    files: QWEN3_ASR_MODEL_FILES,
  },
] as const;
type Model = (typeof BOT_RECOGNITION_MODELS)[number];
type ModelId = Model["id"];
type Recognition = ModelId | "device" | "voice-server" | "elevenlabs";
type ModelState = { ready: boolean; progress: number; downloading: boolean; error: boolean };
const preference = "bots.speech.listening.v1";
const emptyState: ModelState = { ready: false, progress: 0, downloading: false, error: false };
const states = new Map<ModelId, ModelState>();
const listeners = new Set<() => void>();
let selected: Recognition | undefined;
let active: { id: ModelId; controller: AbortController } | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  for (const listener of listeners) listener();
}
function getSelected(): Recognition {
  if (selected === undefined) {
    try {
      const saved = Storage.getItemSync(preference);
      selected =
        saved === "voice-server" || saved === "elevenlabs"
          ? saved
          : (BOT_RECOGNITION_MODELS.find(({ id }) => id === saved)?.id ?? "device");
    } catch {
      return "device";
    }
  }
  return selected;
}
export function useBotRecognition() {
  return useSyncExternalStore(subscribe, getSelected, getSelected);
}
function directoryOf(model: Model) {
  return speechNative ? new Directory(speechNative.modelRoot(), model.directory) : null;
}
const loaderOf = (id: ModelId) =>
  id === "qwen3-asr" ? speechNative?.loadQwenRecognizer : speechNative?.loadRecognizer;

export function supportsBotRecognizer(id: ModelId) {
  return Boolean(
    speechNative?.transcribeFile &&
    loaderOf(id) &&
    (Device.totalMemory === null || Device.totalMemory >= 5 * 1024 ** 3),
  );
}

function modelState(model: Model) {
  const old = states.get(model.id);
  if (old) return old;
  const directory = directoryOf(model);
  const state =
    directory && hasVerifiedSpeechModel(directory, model.files)
      ? { ...emptyState, ready: true, progress: 100 }
      : emptyState;
  states.set(model.id, state);
  return state;
}
export function useBotRecognitionModel(model: Model) {
  const state = useSyncExternalStore(
    subscribe,
    () => modelState(model),
    () => emptyState,
  );
  return { ...state, supported: supportsBotRecognizer(model.id) };
}

export function selectBotRecognition(id: Recognition) {
  if (id === "voice-server") {
    if (!getBotVoiceServer()?.routes.dictation) return;
  } else if (id === "elevenlabs") {
    if (!getBotElevenLabs() || !speechNative?.startCapture) return;
  } else if (id !== "device") {
    const model = BOT_RECOGNITION_MODELS.find((entry) => entry.id === id);
    if (!model || !supportsBotRecognizer(id) || !modelState(model).ready) return;
  }
  Storage.setItemSync(preference, id);
  selected = id;
  publish();
}

export async function downloadBotRecognition(model: Model) {
  const directory = directoryOf(model);
  if (active?.id === model.id) {
    active.controller.abort();
    return;
  }
  if (!directory || active || !supportsBotRecognizer(model.id)) return;
  const controller = new AbortController();
  active = { id: model.id, controller };
  const update = (patch: Partial<ModelState>) => {
    states.set(model.id, { ...modelState(model), ...patch });
    publish();
  };
  update({ downloading: true, error: false, progress: 0 });
  try {
    await verifySpeechFiles(directory, model.files, controller.signal, (ratio) => {
      const progress = Math.floor(ratio * 100);
      if (!controller.signal.aborted && progress !== modelState(model).progress)
        update({ progress });
    });
    if (!controller.signal.aborted)
      update({ ready: hasVerifiedSpeechModel(directory, model.files) });
  } catch {
    if (!controller.signal.aborted) update({ error: true });
  } finally {
    active = null;
    update({ downloading: false });
  }
}

export async function removeBotRecognition(model: Model) {
  if (active) return;
  const directory = directoryOf(model);
  await speechNative?.unloadRecognizer?.();
  if (directory?.exists) directory.delete();
  states.set(model.id, emptyState);
  if (getSelected() === model.id) selectBotRecognition("device");
  else publish();
}

export function botRecognizerAvailable(engine: Recognition) {
  const model = BOT_RECOGNITION_MODELS.find((entry) => entry.id === engine);
  return Boolean(model && supportsBotRecognizer(model.id) && modelState(model).ready);
}

export function getBotSpeechTranscriber(): VoiceTranscriber | null {
  const selected = getSelected();
  if (selected === "voice-server") {
    const transcribe = botVoiceServerTranscriber();
    if (!transcribe) return null;
    return {
      async prepare({ signal }) {
        throwIfVoiceTranscriptionAborted(signal);
        return {
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
          transcribe: (uri, options) => transcribe(uri, options.signal),
        };
      },
    };
  }
  const model = BOT_RECOGNITION_MODELS.find(({ id }) => id === selected);
  if (!model || !supportsBotRecognizer(model.id)) return null;
  const native = speechNative;
  const load = loaderOf(model.id);
  const transcribe = native?.transcribeFile;
  const directory = directoryOf(model);
  if (!native || !load || !transcribe || !directory || !modelState(model).ready) return null;
  return {
    async prepare({ signal }) {
      throwIfVoiceTranscriptionAborted(signal);
      try {
        await load.call(native, directory.uri, 4);
      } catch (cause) {
        throw new VoiceTranscriptionError(
          "preparation-failed",
          "The selected bot speech model could not load.",
          { cause },
        );
      }
      throwIfVoiceTranscriptionAborted(signal);
      return {
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        async transcribe(uri, options) {
          throwIfVoiceTranscriptionAborted(options.signal);
          const text = await transcribe.call(native, uri, directory.uri);
          throwIfVoiceTranscriptionAborted(options.signal);
          return text;
        },
      };
    },
  };
}

function isBotDictationOwner(ownerKey: string) {
  return ownerKey.startsWith('["bot",') || ownerKey.startsWith('["bot-group",');
}

export function usesBotScribeRecognizer(ownerKey: string) {
  return getSelected() === "elevenlabs" && isBotDictationOwner(ownerKey);
}

export function usesBotLocalRecognizer(ownerKey: string) {
  const engine = getSelected();
  return engine !== "device" && engine !== "elevenlabs" && isBotDictationOwner(ownerKey);
}

export function useBotVoiceRecognizerAvailable() {
  const current = useBotRecognition();
  const server = useBotVoiceServer();
  const elevenLabs = useBotElevenLabs();
  const local = useSyncExternalStore(
    subscribe,
    () => (current === "device" ? null : botRecognizerAvailable(current)),
    () => null,
  );
  if (current === "elevenlabs") return Boolean(elevenLabs && speechNative?.startCapture);
  return current === "voice-server" ? Boolean(server?.routes.dictation) : local;
}
