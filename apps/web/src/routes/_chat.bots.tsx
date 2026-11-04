import { createFileRoute, Link } from "@tanstack/react-router";
import { BotWorkspace } from "../components/bots/BotWorkspace";
import { SettingsScopeProvider } from "../components/settings/SettingsScopeContext";
import { validateSettingsRouteSearch } from "../components/settings/settingsScopeNavigation";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { Button } from "../components/ui/button";

export const Route = createFileRoute("/_chat/bots")({
  validateSearch: validateSettingsRouteSearch,
  component: BotsRoute,
});

function BotsRoute() {
  const back = useNavigateToMainApp();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SidebarInset
      {...workspaceAreaProps("bots", 1, "Bot workspace")}
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="text-sm font-medium">Bots</h1>
        <Link className="ml-auto text-sm text-muted-foreground" to="/settings/bots" search={search}>
          Engine and provider settings
        </Link>
        <Button size="sm" variant="ghost" onClick={() => void back()}>
          Back to threads
        </Button>
      </header>
      <SettingsScopeProvider search={search} onChange={(next) => void navigate({ search: next })}>
        <BotWorkspace />
      </SettingsScopeProvider>
    </SidebarInset>
  );
}
