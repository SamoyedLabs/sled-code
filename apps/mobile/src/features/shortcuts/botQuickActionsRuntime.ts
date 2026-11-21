import * as QuickActions from "expo-quick-actions";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { AppState, Platform, Share } from "react-native";
import { useSyncExternalStore } from "react";
import { whenMobileAppUnlocked } from "../app-lock/appLockRuntime";
import {
  BOT_QUICK_ACTION_LIMIT,
  BOT_QUICK_ACTIONS,
  buildBotQuickActions,
  botShareShortcut,
  botShortcutPath,
  DEFAULT_BOT_QUICK_ACTIONS,
  RecentBot,
  sameShortcutBot,
  type BotQuickActionKind,
  type BotShortcutComputer,
} from "./botQuickActions";
import { m } from "../../i18n/messages";
import { msg } from "gt-react-native";

const kindsKey = "sled.bots.quick-actions.v1";
const recentsKey = "sled.bots.quick-actions.recents.v1";
const recentOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const readRecents = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RecentBot)));
const readSaved = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      recents: Schema.Array(RecentBot),
      computer: Schema.NullOr(
        Schema.Struct({
          environmentId: Schema.String,
          hostId: Schema.String,
          name: Schema.String,
        }),
      ),
    }),
  ),
);
const listeners = new Set<() => void>();
let choices = readChoices();
let recents: readonly RecentBot[] = [];
let computer: BotShortcutComputer | null = null;
let load: Promise<boolean> | null = null;
let save = Promise.resolve();
let publishQueue = Promise.resolve();
let lastItems = "";
let lastSaved = "";

function readChoices(): readonly BotQuickActionKind[] {
  if (Platform.OS !== "ios") return [];
  try {
    const value: unknown = JSON.parse(Storage.getItemSync(kindsKey) ?? "null");
    if (Array.isArray(value))
      return BOT_QUICK_ACTIONS.map(({ kind }) => kind)
        .filter((kind) => value.includes(kind))
        .slice(0, BOT_QUICK_ACTION_LIMIT);
  } catch {
    /* Use the source app's defaults when a choice is unavailable. */
  }
  return DEFAULT_BOT_QUICK_ACTIONS;
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function publish() {
  if (Platform.OS !== "ios") return;
  const items = buildBotQuickActions(choices, recents, computer);
  const key = JSON.stringify(items);
  if (key === lastItems) return;
  lastItems = key;
  publishQueue = publishQueue
    .then(() => QuickActions.setItems(items))
    .catch(() => {
      if (lastItems === key) lastItems = "";
    });
}
function publishRecents(next: readonly RecentBot[]) {
  recents = next;
  const key = JSON.stringify({ recents, computer });
  if (key !== lastSaved) {
    lastSaved = key;
    save = save
      .then(() => SecureStore.setItemAsync(recentsKey, key, recentOptions))
      .catch(() => {
        if (key === lastSaved) lastSaved = "";
      });
  }
  publish();
}
function hydrate() {
  load ??= SecureStore.getItemAsync(recentsKey, recentOptions)
    .then((value) => {
      const saved = Option.getOrNull(readSaved(value));
      computer ??= saved?.computer ?? null;
      recents = saved?.recents ?? Option.getOrElse(readRecents(value), () => []);
      lastSaved = value ?? "";
      publish();
      return true;
    })
    .catch(() => {
      load = null;
      return false;
    });
  return load;
}
export function installBotQuickActions(navigate: (href: string) => void) {
  if (Platform.OS !== "ios") return () => {};
  const act = (action: QuickActions.Action) => {
    if (botShareShortcut(action)) {
      whenMobileAppUnlocked(() => {
        void Share.share({
          url: "https://github.com/SamoyedLabs/sled-code",
          title: m(msg("Sled Code")),
        }).catch(() => {});
      });
      return;
    }
    const href =
      typeof action.params?.href === "string" ? botShortcutPath(action.params.href) : null;
    if (href) navigate(href);
  };
  if (QuickActions.initial) act(QuickActions.initial);
  const listener = QuickActions.addListener(act);
  const activity = AppState.addEventListener("change", (state) => {
    if (state === "active") void hydrate();
  });
  void hydrate();
  return () => {
    listener.remove();
    activity.remove();
  };
}

export function updateBotShortcutRoster(
  input: BotShortcutComputer,
  listed?: ReadonlyMap<string, string>,
) {
  if (Platform.OS !== "ios") return;
  computer = input;
  void hydrate().then((ready) => {
    if (!ready) return;
    if (listed)
      publishRecents(
        recents.flatMap((item) => {
          if (item.environmentId !== input.environmentId || item.hostId !== input.hostId)
            return [item];
          const name = listed.get(item.agentId);
          return name ? [{ ...item, name }] : [];
        }),
      );
    else publishRecents(recents);
  });
}
export function recordBotShortcut(bot: RecentBot) {
  if (Platform.OS === "ios")
    void hydrate().then((ready) => {
      if (ready)
        publishRecents([bot, ...recents.filter((item) => !sameShortcutBot(item, bot))].slice(0, 8));
    });
}

export function useBotQuickActionChoices() {
  return useSyncExternalStore(subscribe, () => choices);
}
export function setBotQuickAction(kind: BotQuickActionKind, enabled: boolean) {
  const next = BOT_QUICK_ACTIONS.map((entry) => entry.kind).filter((candidate) =>
    candidate === kind ? enabled : choices.includes(candidate),
  );
  if (next.length > BOT_QUICK_ACTION_LIMIT) return;
  Storage.setItemSync(kindsKey, JSON.stringify(next));
  choices = next;
  for (const listener of listeners) listener();
  publish();
}
