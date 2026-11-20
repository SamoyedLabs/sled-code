import type { HostSettingsSection } from "../bots/upstream/settings/HostSettingsPage";

export type UnifiedBotSettingsSection = HostSettingsSection | "account" | "agents";
export const BOT_HOST_SETTINGS = [
  {
    id: "general",
    label: "Bot hosting",
    navLabel: "Hosting",
    description: "Choose where your bots run and set their shared defaults.",
  },
  {
    id: "agents",
    label: "Individual bots",
    navLabel: "Bot profiles",
    description: "Manage each bot’s identity, model, knowledge and permissions.",
  },
  {
    id: "account",
    label: "Bot account",
    navLabel: "Account",
    description: "Manage the account connected to this bot host.",
  },
  {
    id: "providers",
    label: "Bot models & accounts",
    navLabel: "Models & accounts",
    description: "Connect model providers and manage the accounts available to your bots.",
  },
  {
    id: "mcp",
    label: "Bot tools & MCP",
    navLabel: "Tools & MCP",
    description: "Connect tools and choose what your bots can access.",
  },
  {
    id: "vault",
    label: "Bot Vault",
    navLabel: "Vault",
    description: "Manage the private details your bots can use securely.",
  },
  {
    id: "browser-profiles",
    label: "Bot browser profiles",
    navLabel: "Browser profiles",
    description: "Keep browser sessions and signed-in accounts separate.",
  },
  {
    id: "desktop",
    label: "Bot computer access",
    navLabel: "Computer access",
    description: "Manage the desktop your bots can see and control.",
  },
  {
    id: "storage",
    label: "Bot storage",
    navLabel: "Storage",
    description: "Review files and disk space on this bot host.",
  },
  {
    id: "import",
    label: "Import bots",
    navLabel: "Import",
    description: "Bring existing bots and their configuration into this host.",
  },
  {
    id: "transfer",
    label: "Transfer bots",
    navLabel: "Transfer",
    description: "Review and move bots and host settings between computers.",
  },
  {
    id: "routines",
    label: "Bot routines",
    navLabel: "Routines",
    description: "Manage the shared routine schedule for this host.",
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
