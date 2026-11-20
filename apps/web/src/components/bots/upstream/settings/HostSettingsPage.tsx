import {
  AppWindow,
  ArrowLeftRight,
  Blocks,
  CalendarClock,
  Download,
  Globe2,
  HardDrive,
  History,
  KeyRound,
  Monitor,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { SettingsPage } from "./SettingsPage";
const sections = [
  {
    id: "general",
    title: "General",
    description: "Manage this server’s name, logo, and preferences.",
    icon: Settings,
  },
  {
    id: "vault",
    title: "Vault",
    description: "Save logins, cards and contact info that every agent on this server can fill in.",
    icon: KeyRound,
  },
  {
    id: "members",
    title: "Members",
    description: "Publish this server, invite people, and manage access.",
    icon: UsersRound,
  },
  {
    id: "roles",
    title: "Roles",
    description:
      "Choose the agents that members can use. A member gets the highest access of Everyone and of their roles. Owners and admins can use all agents.",
    icon: ShieldCheck,
  },
  {
    id: "audit",
    title: "Audit log",
    description:
      "Changes to the members, roles and agent access of this server, newest first. The host keeps the newest 500 changes.",
    icon: History,
  },
  {
    id: "desktop",
    title: "Remote desktop",
    description: "Configure or connect to this server’s desktop.",
    icon: Monitor,
  },
  {
    id: "mcp",
    title: "MCP",
    description: "Connect MCP servers and choose which ones this server’s agents can use.",
    icon: Blocks,
  },
  {
    id: "storage",
    title: "Storage",
    description: "See what OpenBot keeps on this server’s disk, and free space.",
    icon: HardDrive,
  },
  {
    id: "sites",
    title: "Sites",
    description: "The static sites that agents on this server published to openbot.site.",
    icon: Globe2,
  },
  {
    id: "providers",
    title: "Providers",
    description: "Manage the AI providers of the computer that runs this server.",
    icon: Sparkles,
  },
  {
    id: "updates",
    title: "Updates",
    description: "Update OpenBot on the computer that runs this server.",
    icon: RefreshCw,
  },
  {
    id: "import",
    title: "Import",
    description: "Move your agents from Grok Bot or Hermes Agent to this server.",
    icon: Download,
  },
  {
    id: "transfer",
    title: "Transfer",
    description: "Move this server's agents and server settings to or from a file.",
    icon: ArrowLeftRight,
  },
  {
    id: "routines",
    title: "Routines",
    description: "Show the routine schedule of this computer in a calendar app.",
    icon: CalendarClock,
  },
  {
    id: "browser-profiles",
    title: "Browser profiles",
    description: "Manage browser profiles for agents on this server.",
    icon: AppWindow,
  },
] as const;
export type HostSettingsSection = (typeof sections)[number]["id"];
export function HostSettingsPage({
  panels,
  initialSection,
  embeddedSection,
}: {
  panels: Readonly<Partial<Record<HostSettingsSection, ReactNode>>>;
  initialSection?: HostSettingsSection | undefined;
  embeddedSection?: HostSettingsSection | undefined;
}) {
  if (embeddedSection) return panels[embeddedSection] ?? null;
  return (
    <SettingsPage
      label="Server settings"
      initialSection={initialSection}
      sections={sections.flatMap((section) =>
        panels[section.id] === undefined ? [] : [{ ...section, content: panels[section.id] }],
      )}
    />
  );
}
