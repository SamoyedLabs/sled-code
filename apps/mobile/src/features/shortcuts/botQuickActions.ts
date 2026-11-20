import type { Action } from "expo-quick-actions";
import { parseBotNotificationDeepLink } from "@t3tools/shared/agentAwareness";
import * as Schema from "effect/Schema";

export const BOT_QUICK_ACTIONS = [
  { kind: "latest", title: "Latest bot chat" },
  { kind: "second", title: "Second latest bot chat" },
  { kind: "routines", title: "Schedule" },
  { kind: "search", title: "Search bots" },
  { kind: "share", title: "Share Sled" },
  { kind: "support", title: "Get support" },
] as const;
export type BotQuickActionKind = (typeof BOT_QUICK_ACTIONS)[number]["kind"];
export const DEFAULT_BOT_QUICK_ACTIONS: readonly BotQuickActionKind[] = [
  "latest",
  "routines",
  "search",
  "support",
];
export const BOT_QUICK_ACTION_LIMIT = 4;

export const RecentBot = Schema.Struct({
  environmentId: Schema.String,
  hostId: Schema.String,
  agentId: Schema.String,
  name: Schema.String,
});
export type RecentBot = typeof RecentBot.Type;
export type BotShortcutComputer = Pick<RecentBot, "environmentId" | "hostId"> & { name: string };
const SEARCH = "/bots?quickAction=search";
const SCHEDULE = "/bot-schedule";
const SUPPORT = "/settings/diagnostics";
const SHARE = "bots-share-app";
const botPath = (bot: RecentBot) =>
  "/bots/" + [bot.environmentId, bot.hostId, bot.agentId].map(encodeURIComponent).join("/");
export const sameShortcutBot = (a: RecentBot, b: RecentBot) => botPath(a) === botPath(b);
export const botShareShortcut = (action: Action) => action.id === SHARE;
const schedulePath = ({ environmentId, hostId }: BotShortcutComputer) =>
  SCHEDULE + "/" + [environmentId, hostId].map(encodeURIComponent).join("/");

export function botShortcutPath(path: string) {
  const direct = parseBotNotificationDeepLink(path);
  return path === SEARCH ||
    path === SUPPORT ||
    (/^\/bot-schedule\/[^/?#]+\/[^/?#]+$/.test(path) &&
      parseBotNotificationDeepLink("/bots" + path.slice(SCHEDULE.length) + "/schedule") !== null) ||
    (direct?.kind === "bot" && !direct.taskId && !direct.channelId && !direct.routineId)
    ? path
    : null;
}

export function buildBotQuickActions(
  choice: readonly BotQuickActionKind[],
  bots: readonly RecentBot[],
  computer: BotShortcutComputer | null,
): Action[] {
  const actions: Action[] = [];
  const chat = (bot: RecentBot | undefined) => {
    if (!bot?.name.trim()) return;
    const href = botPath(bot);
    actions.push({ id: "chat:" + href, title: bot.name, icon: "message", params: { href } });
  };
  const show = (id: string, title: string, icon: Action["icon"], href: string, subtitle?: string) =>
    actions.push({ id, title, icon, params: { href }, subtitle });
  for (const { kind } of BOT_QUICK_ACTIONS) {
    if (!choice.includes(kind)) continue;
    switch (kind) {
      case "latest":
        if (computer) chat(bots[0]);
        break;
      case "second":
        if (computer) chat(bots[1]);
        break;
      case "routines":
        if (computer) show(kind, "Schedule", "date", schedulePath(computer), computer.name);
        break;
      case "search":
        if (computer) show(kind, "Search bots", "search", SEARCH, computer.name);
        break;
      case "share":
        actions.push({ id: SHARE, title: "Share Sled", icon: "share" });
        break;
      case "support":
        show(kind, "Get support", "symbol:questionmark.circle", SUPPORT);
        break;
    }
  }
  return actions.slice(0, BOT_QUICK_ACTION_LIMIT);
}
