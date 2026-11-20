import Storage from "expo-sqlite/kv-store";

// OpenBot mobile 1.4.11 voice-settings.ts.
const PREF = "bots.speech.turnPauseMs.v1";
const DEFAULT = 1_500;
export const BOT_TURN_PAUSE = { min: 1_000, max: 10_000, step: 500 } as const;

function normalizePause(value: number) {
  const { min, max, step } = BOT_TURN_PAUSE;
  if (!Number.isFinite(value)) return DEFAULT;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

export function getBotTurnPause() {
  try {
    const value = Storage.getItemSync(PREF);
    return value === null ? DEFAULT : normalizePause(Number(value));
  } catch {
    return DEFAULT;
  }
}

export function saveBotTurnPause(value: number) {
  const pause = normalizePause(value);
  Storage.setItemSync(PREF, String(pause));
  return pause;
}
