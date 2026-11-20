/* oxlint-disable shadcn/no-unknown-classes -- Bot usage styles are scoped by the imported openbot-react.css. */
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Activity, useState } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { ReactBotUsage } from "../bots/ReactBotUsage";
import { SourceProviderHost } from "../bots/SourceProviderEnvironment";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { UsagePage } from "./UsagePage";
import "../bots/upstream/openbot-react.css";

export function validateUsageSearch(value: Record<string, unknown>): {
  view?: "bots" | "threads" | "limits";
  machine?: string;
} {
  return {
    ...(value.view === "bots" || value.view === "threads" || value.view === "limits"
      ? { view: value.view }
      : {}),
    ...(typeof value.machine === "string" ? { machine: value.machine } : {}),
  };
}
const views = ["bots", "threads", "limits"] as const;
type View = (typeof views)[number];
export function UnifiedUsagePage() {
  const search = useLocation({ select: (location) => validateUsageSearch(location.search) });
  const navigate = useNavigate();
  const [lastView, setLastView] = useState<View>("bots");
  const view = search.view ?? lastView;
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const environment =
    environments.find((item) => item.environmentId === search.machine) ??
    environments.find((item) => item.environmentId === primary) ??
    environments[0];
  const [visited, setVisited] = useState<readonly View[]>([view]);
  if (!visited.includes(view)) setVisited([...visited, view]);
  const changeView = (value: View) => {
    setLastView(value);
    void navigate({ to: "/usage", search: { ...search, view: value } });
  };
  return (
    <AppRouteModal label="Usage">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b px-5 pe-2">
        <h1 className="text-sm font-semibold">Usage</h1>
        <nav
          aria-label="Usage views"
          className="flex items-center gap-1 rounded-lg bg-muted/50 p-1"
        >
          {views.map((value) => (
            <button
              key={value}
              type="button"
              aria-current={view === value ? "page" : undefined}
              className="rounded-md px-3 py-1 text-sm text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
              onClick={() => {
                changeView(value);
              }}
            >
              {value === "bots" ? "Bots" : value === "threads" ? "Threads" : "Limits"}
            </button>
          ))}
        </nav>
        <div className="ml-auto" />
        {view === "bots" && environments.length > 1 && (
          <Select
            value={environment?.environmentId ?? ""}
            onValueChange={(value) => {
              if (value) void navigate({ to: "/usage", search: { view: "bots", machine: value } });
            }}
          >
            <SelectTrigger aria-label="Bot usage environment" size="compact" variant="ghost">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {environments.map((item) => (
                <SelectItem key={item.environmentId} value={item.environmentId}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        <AppRouteModalClose />
      </header>
      {visited.map((panel) => (
        <section
          key={panel}
          className="flex min-h-0 flex-1 flex-col"
          hidden={panel !== view}
          style={{ display: panel === view ? undefined : "none" }}
        >
          <Activity mode={panel === view ? "visible" : "hidden"}>
            {panel === "bots" ? (
              <BotUsagePanel environment={environment} />
            ) : (
              <UsagePage embedded surface={panel} onSurfaceChange={changeView} />
            )}
          </Activity>
        </section>
      ))}
      <p className="shrink-0 border-t px-5 py-2 text-xs text-muted-foreground">
        Bot activity can also appear in provider logs. Bots and Threads totals are separate views,
        not additive.
      </p>
    </AppRouteModal>
  );
}

function BotUsagePanel({
  environment,
}: {
  environment: ReturnType<typeof useEnvironments>["environments"][number] | undefined;
}) {
  const host = useEnvironmentQuery(
    environment ? openbot.status({ environmentId: environment.environmentId, input: {} }) : null,
  );
  const hostId = host.data?.state === "ready" ? host.data.hostId : null;
  return (
    <div className="openbot-react flex min-h-0 flex-1 flex-col bg-background!">
      {environment && hostId ? (
        <SourceProviderHost environmentId={environment.environmentId} hostId={hostId}>
          <ReactBotUsage
            key={`${environment.environmentId}:${hostId}`}
            environmentId={environment.environmentId}
            hostId={hostId}
            hostName={environment.label}
          />
        </SourceProviderHost>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          {host.isPending
            ? "Loading bot usage…"
            : (host.error ?? "Connect a bot host to see its usage.")}
        </p>
      )}
    </div>
  );
}
