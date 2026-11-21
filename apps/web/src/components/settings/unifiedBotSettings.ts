import type { HostSettingsSection } from "../bots/upstream/settings/HostSettingsPage";
import { m } from "../../i18n/messages";
import { msg } from "gt-react";

export type UnifiedBotSettingsSection = HostSettingsSection | "account" | "agents";
export const BOT_HOST_SETTINGS = [
  {
    id: "general",
    label: m(msg("Bot hosting")),
    navLabel: m(msg("Hosting")),
    description: m(msg("Choose where your bots run and set their shared defaults.")),
  },
  {
    id: "agents",
    label: m(msg("Individual bots")),
    navLabel: m(msg("Bot profiles")),
    description: m(msg("Manage each bot’s identity, model, knowledge and permissions.")),
  },
  {
    id: "account",
    label: m(msg("Bot account")),
    navLabel: m(msg("Account")),
    description: m(msg("Manage the account connected to this bot host.")),
  },
  {
    id: "providers",
    label: m(msg("Bot models & accounts")),
    navLabel: m(msg("Models & accounts")),
    description: m(msg("Connect model providers and manage the accounts available to your bots.")),
  },
  {
    id: "mcp",
    label: m(msg("Bot tools & MCP")),
    navLabel: m(msg("Tools & MCP")),
    description: m(msg("Connect tools and choose what your bots can access.")),
  },
  {
    id: "vault",
    label: m(msg("Bot Vault")),
    navLabel: m(msg("Vault")),
    description: m(msg("Manage the private details your bots can use securely.")),
  },
  {
    id: "browser-profiles",
    label: m(msg("Bot browser profiles")),
    navLabel: m(msg("Browser profiles")),
    description: m(msg("Keep browser sessions and signed-in accounts separate.")),
  },
  {
    id: "desktop",
    label: m(msg("Bot computer access")),
    navLabel: m(msg("Computer access")),
    description: m(msg("Manage the desktop your bots can see and control.")),
  },
  {
    id: "storage",
    label: m(msg("Bot storage")),
    navLabel: m(msg("Storage")),
    description: m(msg("Review files and disk space on this bot host.")),
  },
  {
    id: "import",
    label: m(msg("Import bots")),
    navLabel: m(msg("Import")),
    description: m(msg("Bring existing bots and their configuration into this host.")),
  },
  {
    id: "transfer",
    label: m(msg("Transfer bots")),
    navLabel: m(msg("Transfer")),
    description: m(msg("Review and move bots and host settings between computers.")),
  },
  {
    id: "routines",
    label: m(msg("Bot routines")),
    navLabel: m(msg("Routines")),
    description: m(msg("Manage the shared routine schedule for this host.")),
  },
] as const satisfies readonly {
  id: UnifiedBotSettingsSection;
  label: string;
  navLabel: string;
  description: string;
}[];
export function botHostSettingsSection(hash: string): UnifiedBotSettingsSection {
  if (hash.startsWith("bot-agent-")) return "agents";
  return BOT_HOST_SETTINGS.find((item) => `bot-host-${item.id}` === hash)?.id ?? "general";
}
