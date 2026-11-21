import * as Haptics from "expo-haptics";
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { useReducedMotion as useSystemReducedMotion } from "react-native-reanimated";
import { replyWordFeedback } from "./upstream/openbot-mobile/chat-preview/reply-playback";

const defaults = {
  animations: true,
  agentFaces: true,
  textReveal: true,
  searchTransitions: true,
  compactComposer: true,
  haptics: true,
  replyHaptics: true,
};
type Preferences = typeof defaults;
export type BotMotionPreference =
  | "agentFaces"
  | "textReveal"
  | "searchTransitions"
  | "compactComposer";
const key = "sled.bots.feedback.v1";
const listeners = new Set<() => void>();
let preferences: Preferences | undefined;

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(Storage.getItemSync(key) ?? "null") as Partial<Preferences> | null;
    const saved = { ...defaults };
    for (const name of Object.keys(defaults) as (keyof Preferences)[])
      if (typeof value?.[name] === "boolean") saved[name] = value[name]!;
    return saved;
  } catch {
    return defaults;
  }
}
const snapshot = () => (preferences ??= readPreferences());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const useBotFeedback = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export function saveBotFeedback<K extends keyof Preferences>(name: K, value: Preferences[K]) {
  const next = { ...snapshot(), [name]: value };
  Storage.setItemSync(key, JSON.stringify(next));
  preferences = next;
  for (const listener of listeners) listener();
}

export function useBotReducedMotion() {
  const system = useSystemReducedMotion();
  const { animations } = useBotFeedback();
  return system || !animations;
}

export function useBotMotion(name: BotMotionPreference) {
  const reduced = useBotReducedMotion();
  const enabled = useSyncExternalStore(
    subscribe,
    () => snapshot()[name],
    () => defaults[name],
  );
  return enabled && !reduced;
}

async function play(feedback: () => Promise<void>) {
  if (!snapshot().haptics) return;
  await feedback().catch(() => {});
}
export const selectionAsync = () => play(Haptics.selectionAsync);
export const impactAsync = (style: Haptics.ImpactFeedbackStyle) =>
  play(() => Haptics.impactAsync(style));
export const botReplyTick = (word: string, index: number) => {
  if (!snapshot().replyHaptics) return;
  const feedback = replyWordFeedback(word, index);
  if (feedback === "light") void impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (feedback === "soft") void impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  else void selectionAsync();
};
export { ImpactFeedbackStyle } from "expo-haptics";
