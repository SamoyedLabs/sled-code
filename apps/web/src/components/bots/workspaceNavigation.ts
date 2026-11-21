import type { SettingsScopeSearch } from "../settings/settingsScope";
import { validateSettingsRouteSearch } from "../settings/settingsScopeNavigation";

const BOT_WORKSPACE_PAGES = [
  "chats",
  "tasks",
  "flows",
  "workflows",
  "schedule",
  "marketplace",
  "usage",
  "attention",
  "manage",
  "search",
] as const;
export type BotWorkspacePage = (typeof BOT_WORKSPACE_PAGES)[number];
export interface BotWorkspaceSearch extends SettingsScopeSearch {
  botPage?: BotWorkspacePage | undefined;
  botAgent?: string | undefined;
  botChannel?: string | undefined;
  botHost?: string | undefined;
  botVisit?: string | undefined;
  botCreate?: "group" | undefined;
  botMessage?: string | undefined;
  botTask?: string | undefined;
  botRoutine?: string | undefined;
}
export function validateBotWorkspaceSearch(raw: Record<string, unknown>): BotWorkspaceSearch {
  return {
    ...validateSettingsRouteSearch(raw),
    ...(typeof raw.botPage === "string" && BOT_WORKSPACE_PAGES.some((page) => page === raw.botPage)
      ? { botPage: raw.botPage as BotWorkspacePage }
      : {}),
    botAgent: typeof raw.botAgent === "string" ? raw.botAgent : undefined,
    botChannel: typeof raw.botChannel === "string" ? raw.botChannel : undefined,
    botHost: typeof raw.botHost === "string" ? raw.botHost : undefined,
    botMessage: typeof raw.botMessage === "string" ? raw.botMessage : undefined,
    botTask: typeof raw.botTask === "string" ? raw.botTask : undefined,
    botRoutine: typeof raw.botRoutine === "string" ? raw.botRoutine : undefined,
    botVisit: typeof raw.botVisit === "string" ? raw.botVisit : undefined,
    botCreate: raw.botCreate === "group" ? "group" : undefined,
  };
}
