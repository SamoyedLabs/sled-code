import { beforeEach, expect, it, vi } from "vite-plus/test";

const effects = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  impact: vi.fn(async () => {}),
  select: vi.fn(async () => {}),
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => effects.storage.get(key) ?? null,
    setItemSync: (key: string, value: string) => effects.storage.set(key, value),
  },
}));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
vi.mock("expo-haptics", () => ({
  selectionAsync: effects.select,
  impactAsync: effects.impact,
  ImpactFeedbackStyle: { Light: "light", Soft: "soft" },
}));
import { botReplyTick, saveBotFeedback, selectionAsync } from "./botFeedback";

beforeEach(() => {
  effects.select.mockClear();
  effects.impact.mockClear();
  saveBotFeedback("haptics", true);
  saveBotFeedback("replyHaptics", true);
});

it("keeps gesture feedback while reply feedback is turned off", async () => {
  saveBotFeedback("replyHaptics", false);
  botReplyTick("end.", 0);
  await selectionAsync();
  expect(effects.impact).not.toHaveBeenCalled();
  expect(effects.select).toHaveBeenCalledOnce();
});

it("applies the pinned reply alphas and gates every vibration under the master control", async () => {
  botReplyTick("end.", 0);
  botReplyTick("strong", 4);
  botReplyTick("word", 5);
  expect(effects.impact.mock.calls).toEqual([["light"], ["soft"]]);
  expect(effects.select).toHaveBeenCalledOnce();
  saveBotFeedback("haptics", false);
  botReplyTick("second.", 1);
  await selectionAsync();
  expect(effects.impact).toHaveBeenCalledTimes(2);
  expect(effects.select).toHaveBeenCalledOnce();
});
