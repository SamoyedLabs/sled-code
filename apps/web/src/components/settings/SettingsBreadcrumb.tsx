import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";
import { useLocation } from "@tanstack/react-router";
import { BOT_HOST_SETTINGS, botHostSettingsSection } from "./unifiedBotSettings";

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_BREADCRUMB_LABELS[normalizedPathname] ?? null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const hash = useLocation({ select: (location) => location.hash });
  const sectionLabel = settingsBreadcrumbLabel(pathname);
  const botSection =
    pathname === "/settings/bots"
      ? BOT_HOST_SETTINGS.find((item) => item.id === botHostSettingsSection(hash))
      : undefined;

  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current={!botSection} className="truncate">
        {sectionLabel ?? "Settings"}
      </WorkspaceBreadcrumbItem>
      {botSection && (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="truncate">
            {botSection.navLabel}
          </WorkspaceBreadcrumbItem>
        </>
      )}
    </WorkspaceBreadcrumb>
  );
}
