import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import {
  type AvatarColor,
  type ChatBackgroundScheme,
  readableChatBackground,
} from "./upstream/chat-colors";

export type MessageColorMode = "none" | "agent" | "custom";
export type BotChatSwipeAction = "threads" | "browser" | "off";

type Appearance = {
  messageColor: MessageColorMode;
  customColor: AvatarColor;
  background: Record<ChatBackgroundScheme, AvatarColor | null>;
  showActivity: boolean;
  showSubagents: boolean;
  showMemoryChanges: boolean;
  swipeAction: BotChatSwipeAction;
  pullInfo: boolean;
  fullQualityPhotos: boolean;
  automaticLargeFiles: boolean;
};

const storageKey = "bots.chat.appearance.v1";
const defaults: Appearance = {
  messageColor: "agent",
  customColor: "#4699fe",
  background: { dark: null, light: null },
  showActivity: true,
  showSubagents: true,
  showMemoryChanges: true,
  swipeAction: "threads",
  pullInfo: true,
  fullQualityPhotos: false,
  automaticLargeFiles: false,
};

export function isBotChatColor(value: unknown): value is AvatarColor {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value);
}

function readPreferences(): Appearance {
  try {
    const value = JSON.parse(
      Storage.getItemSync(storageKey) ?? "null",
    ) as Partial<Appearance> | null;
    if (!value) return defaults;
    const mode = value.messageColor;
    return {
      messageColor: mode === "none" || mode === "custom" ? mode : defaults.messageColor,
      customColor: isBotChatColor(value.customColor) ? value.customColor : defaults.customColor,
      background: {
        dark: isBotChatColor(value.background?.dark) ? value.background.dark : null,
        light: isBotChatColor(value.background?.light) ? value.background.light : null,
      },
      showActivity: value.showActivity !== false,
      showSubagents: value.showSubagents !== false,
      showMemoryChanges: value.showMemoryChanges !== false,
      swipeAction:
        value.swipeAction === "browser" || value.swipeAction === "off"
          ? value.swipeAction
          : defaults.swipeAction,
      pullInfo: value.pullInfo !== false,
      fullQualityPhotos: value.fullQualityPhotos === true,
      automaticLargeFiles: value.automaticLargeFiles === true,
    };
  } catch {
    return defaults;
  }
}

let preferences: Appearance | undefined;
const listeners = new Set<() => void>();
function snapshot() {
  return (preferences ??= readPreferences());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBotChatAppearance() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function saveBotChatAppearance(update: Partial<Appearance>) {
  const next = { ...snapshot(), ...update };
  Storage.setItemSync(storageKey, JSON.stringify(next));
  preferences = next;
  for (const listener of listeners) listener();
}

export function botChatCanvas(
  appearance: Appearance,
  scheme: ChatBackgroundScheme,
  fallback: string,
) {
  const color = appearance.background[scheme];
  return color ? readableChatBackground(color, scheme) : fallback;
}

// The same foreground contrast calculation as OpenBot mobile's onboarding-colors.ts.
export function readableOnBotColor(fill: AvatarColor) {
  const channel = (offset: number) => {
    const value = Number.parseInt(fill.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return (luminance + 0.05) / 0.0556 > 1.05 / (luminance + 0.05) ? "#141414" : "#ffffff";
}

export function botMessageColors(appearance: Appearance, agentColor?: AvatarColor) {
  const fill =
    appearance.messageColor === "custom"
      ? appearance.customColor
      : appearance.messageColor === "agent"
        ? agentColor
        : undefined;
  return fill ? { fill, text: readableOnBotColor(fill) } : null;
}
