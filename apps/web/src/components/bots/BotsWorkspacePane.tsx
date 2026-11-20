import { Activity, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ReactBotWorkspace } from "./ReactBotWorkspace";
import { SettingsScopeProvider } from "../settings/SettingsScopeContext";
import { validateSettingsRouteSearch } from "../settings/settingsScopeNavigation";

export function BotsWorkspacePane({ active }: { active: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [retainedSearch, setRetainedSearch] = useState(location.search);
  if (active && location.pathname.startsWith("/bots") && retainedSearch !== location.search)
    setRetainedSearch(location.search);
  const search = validateSettingsRouteSearch(
    active && location.pathname.startsWith("/bots") ? location.search : retainedSearch,
  );
  return (
    <section
      aria-label="Bot workspace"
      className="absolute inset-0 flex min-h-0 flex-col bg-background"
      style={{ display: active ? undefined : "none" }}
      inert={!active}
    >
      <Activity mode={active ? "visible" : "hidden"}>
        <SettingsScopeProvider
          search={search}
          onChange={(next) => void navigate({ to: "/bots", search: next })}
        >
          <ReactBotWorkspace active={active} />
        </SettingsScopeProvider>
      </Activity>
    </section>
  );
}
