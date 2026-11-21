import {
  AppWindow,
  ArrowLeftRight,
  Blocks,
  CalendarClock,
  Cpu,
  Download,
  Globe2,
  HardDrive,
  History,
  KeyRound,
  Monitor,
  RefreshCw,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { SettingsPage } from "./SettingsPage";
import { m } from "../../../../i18n/messages";
import { msg, useGT } from "gt-react";
const sections = [
  {
    id: "general",
    title: m(msg("General")),
    description: m(msg("Manage this server’s name, logo, and preferences.")),
    icon: Settings,
  },
  {
    id: "vault",
    title: m(msg("Vault")),
    description: m(
      msg("Save logins, cards and contact info that every agent on this server can fill in."),
    ),
    icon: KeyRound,
  },
  {
    id: "members",
    title: m(msg("Members")),
    description: m(msg("Publish this server, invite people, and manage access.")),
    icon: UsersRound,
  },
  {
    id: "roles",
    title: m(msg("Roles")),
    description: m(
      msg(
        "Choose the agents that members can use. A member gets the highest access of Everyone and of their roles. Owners and admins can use all agents.",
      ),
    ),
    icon: ShieldCheck,
  },
  {
    id: "audit",
    title: m(msg("Audit log")),
    description: m(
      msg(
        "Changes to the members, roles and agent access of this server, newest first. The host keeps the newest 500 changes.",
      ),
    ),
    icon: History,
  },
  {
    id: "desktop",
    title: m(msg("Remote desktop")),
    description: m(msg("Configure or connect to this server’s desktop.")),
    icon: Monitor,
  },
  {
    id: "mcp",
    title: "MCP",
    description: m(msg("Connect MCP servers and choose which ones this server’s agents can use.")),
    icon: Blocks,
  },
  {
    id: "storage",
    title: m(msg("Storage")),
    description: m(msg("See what OpenBot keeps on this server’s disk, and free space.")),
    icon: HardDrive,
  },
  {
    id: "sites",
    title: m(msg("Sites")),
    description: m(msg("The static sites that agents on this server published to openbot.site.")),
    icon: Globe2,
  },
  {
    id: "providers",
    title: m(msg("Providers")),
    description: m(msg("Manage the AI providers of the computer that runs this server.")),
    icon: Cpu,
  },
  {
    id: "updates",
    title: m(msg("Updates")),
    description: m(msg("Update OpenBot on the computer that runs this server.")),
    icon: RefreshCw,
  },
  {
    id: "import",
    title: m(msg("Import")),
    description: m(msg("Move your agents from Grok Bot or Hermes Agent to this server.")),
    icon: Download,
  },
  {
    id: "transfer",
    title: m(msg("Transfer")),
    description: m(msg("Move this server's agents and server settings to or from a file.")),
    icon: ArrowLeftRight,
  },
  {
    id: "routines",
    title: m(msg("Routines")),
    description: m(msg("Show the routine schedule of this computer in a calendar app.")),
    icon: CalendarClock,
  },
  {
    id: "browser-profiles",
    title: m(msg("Browser profiles")),
    description: m(msg("Manage browser profiles for agents on this server.")),
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
  const gt = useGT();
  if (embeddedSection) return panels[embeddedSection] ?? null;
  return (
    <SettingsPage
      label={gt("Server settings")}
      initialSection={initialSection}
      sections={sections.flatMap((section) =>
        panels[section.id] === undefined ? [] : [{ ...section, content: panels[section.id] }],
      )}
    />
  );
}
