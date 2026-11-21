/* oxlint-disable shadcn/no-unknown-classes -- The actual host panels reuse scoped OpenBot CSS. */
import { lazy, Suspense, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer } from "./settingsLayout";
import { botHostSettingsSection, BOT_HOST_SETTINGS } from "./unifiedBotSettings";
import { Button } from "../ui/button";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { SettingsGroup } from "./SettingsGroup";
import { SourceAgentAvatar } from "../bots/SourceAgentAvatar";
import { ServerIcon, BotIcon, RefreshCwIcon } from "lucide-react";
import "../bots/sled-bots.css";
import { SourceAgentSettings } from "../bots/SourceAgentSettings";
import { SourceHostAccount } from "../bots/SourceHostAccount";
import { SourceProviderHost } from "../bots/SourceProviderEnvironment";
import "../bots/upstream/openbot-react.css";
import { T, Var, useGT } from "gt-react";
const SourceHostSettings = lazy(() =>
  import("../bots/SourceHostEnvironment").then((m) => ({ default: m.SourceHostSettings })),
);

export function BotsSettings() {
  const gt = useGT();
  const navigate = useNavigate();
  const { environment, connectedEnvironments } = useSettingsScope();
  const hash = useLocation({ select: (location) => location.hash });
  const [chosen, setChosen] = useState<string | null>(null);
  const target =
    environment ??
    connectedEnvironments.find((item) => item.environmentId === chosen) ??
    connectedEnvironments[0];
  return (
    <SettingsPageContainer>
      <div className="space-y-6">
        <div className="md:hidden">
          <Select
            value={botHostSettingsSection(hash)}
            onValueChange={(value) => {
              if (value)
                void navigate({ to: "/settings/bots", hash: `bot-host-${value}`, search: true });
            }}
            items={BOT_HOST_SETTINGS.map((item) => ({ value: item.id, label: item.navLabel }))}
          >
            <SelectTrigger aria-label={gt("Bot settings section")}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {BOT_HOST_SETTINGS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.navLabel}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {connectedEnvironments.length > 1 && !environment && (
          <div className="max-w-sm space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              <T>Computer</T>
            </p>
            <Select
              value={target?.environmentId ?? ""}
              onValueChange={setChosen}
              items={connectedEnvironments.map((item) => ({
                value: item.environmentId,
                label: item.label,
              }))}
            >
              <SelectTrigger aria-label={gt("Bot settings computer")}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {connectedEnvironments.map((item) => (
                  <SelectItem key={item.environmentId} value={item.environmentId}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        )}
        {target ? (
          <BotHostPreferences
            key={target.environmentId}
            environmentId={target.environmentId}
            label={target.label}
            section={botHostSettingsSection(hash)}
            requestedAgent={
              hash.startsWith("bot-agent-") ? hash.slice("bot-agent-".length) : undefined
            }
          />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border/60 p-6">
            <ServerIcon aria-hidden className="size-6 text-muted-foreground" />
            <h2 className="text-balance text-lg font-medium">
              <T>Connect a computer</T>
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              <T>Choose a connected computer to manage its bot hosting and settings.</T>
            </p>
            <Button variant="outline" render={<Link to="/settings/connections" />}>
              <T>Open connections</T>
            </Button>
          </div>
        )}
      </div>
    </SettingsPageContainer>
  );
}
function BotHostPreferences({
  environmentId,
  label,
  section,
  requestedAgent,
}: {
  environmentId: EnvironmentId;
  label: string;
  section: ReturnType<typeof botHostSettingsSection>;
  requestedAgent?: string | undefined;
}) {
  const gt = useGT();
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const canStart = useAtomValue(openbot.start.permissionAtom(environmentId));
  const canStop = useAtomValue(openbot.stop.permissionAtom(environmentId));
  const start = useAtomCommand(openbot.start, { reportFailure: false });
  const stop = useAtomCommand(openbot.stop, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = host.data?.state === "ready";
  const change = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const result = await (running ? stop : start)({ environmentId, input: {} });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      host.refresh();
    });
    if (settled._tag === "Failure") {
      setError(gt("Could not change bot hosting. Refresh and try again."));
    }
    setBusy(false);
  };
  const definition = BOT_HOST_SETTINGS.find((item) => item.id === section);
  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-2">
        <h2 className="text-balance text-xl font-semibold">{definition?.navLabel}</h2>
        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {definition?.description}
        </p>
      </header>
      {section === "general" && (
        <SettingsGroup>
          <section className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0 flex-1 basis-60 space-y-1.5">
              <h3 className="text-sm font-medium">
                <T>Run bots on this computer</T>
              </h3>
              <p className="max-w-xl text-pretty text-xs leading-relaxed text-muted-foreground">
                <T>
                  Run bots locally, or leave hosting off and connect to another computer. Coding and
                  remote desktop settings are independent.
                </T>
              </p>
              <p role="status" className="text-xs text-muted-foreground">
                {host.isPending
                  ? gt("Checking hosting…")
                  : running
                    ? gt("Hosting is running")
                    : gt("Hosting: {value}", { value: host.data?.state ?? "unavailable" })}
              </p>
            </div>
            <Button
              size="sm"
              variant={running ? "outline" : "default"}
              disabled={busy || host.isPending || (running ? !canStop : !canStart)}
              onClick={() => void change()}
            >
              {busy ? gt("Updating…") : running ? gt("Stop hosting") : gt("Start hosting")}
            </Button>
          </section>
        </SettingsGroup>
      )}
      {(error || host.error) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
        >
          <p className="min-w-0 flex-1 text-pretty text-sm text-destructive">
            {error ?? host.error}
          </p>
          <Button variant="outline" size="sm" onClick={host.refresh}>
            <RefreshCwIcon aria-hidden className="size-3.5" />
            <T>Try again</T>
          </Button>
        </div>
      )}
      {running && host.data?.hostId ? (
        <div className="openbot-react bot-settings-surface min-w-0 space-y-6">
          <SourceProviderHost environmentId={environmentId} hostId={host.data.hostId}>
            <Suspense fallback={<BotSettingsLoading />}>
              {section === "agents" ? (
                <UnifiedBotPreferences
                  environmentId={environmentId}
                  hostId={host.data.hostId}
                  requestedAgent={requestedAgent}
                />
              ) : section === "account" ? (
                <SourceHostAccount
                  environmentId={environmentId}
                  hostId={host.data.hostId}
                  hostName={label}
                />
              ) : (
                <SourceHostSettings
                  environmentId={environmentId}
                  hostId={host.data.hostId}
                  hostName={label}
                  embeddedSection={section}
                />
              )}
            </Suspense>
          </SourceProviderHost>
        </div>
      ) : host.isPending ? (
        <BotSettingsLoading />
      ) : (
        section !== "general" &&
        !host.error && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border/60 p-6">
            <ServerIcon aria-hidden className="size-6 text-muted-foreground" />
            <h3 className="text-balance text-base font-medium">
              <T>Bot hosting is off</T>
            </h3>
            <p className="text-pretty text-sm text-muted-foreground">
              <T>
                Start hosting on <Var>{label}</Var> to manage these settings.
              </T>
            </p>
            <Button variant="outline" disabled={busy || !canStart} onClick={() => void change()}>
              {busy ? gt("Starting…") : gt("Start hosting")}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function UnifiedBotPreferences({
  environmentId,
  hostId,
  requestedAgent,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  requestedAgent?: string | undefined;
}) {
  const gt = useGT();
  const agents = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const [chosen, setChosen] = useState<string | null>(null);
  const targetId = chosen ?? requestedAgent;
  const selected = targetId
    ? agents.data?.find((agent) => agent.id === targetId)
    : agents.data?.[0];
  const navigate = useNavigate();
  return (
    <div className="space-y-5">
      {agents.isPending && !agents.data ? (
        <BotSettingsLoading />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4">
          {selected && <SourceAgentAvatar agent={selected} size={36} />}
          <div className="min-w-0 flex-1 basis-40 space-y-1">
            <p className="text-sm font-medium">
              <T>Bot profile</T>
            </p>
            <p className="text-pretty text-xs text-muted-foreground">
              <T>Choose a bot. Profile edits save automatically.</T>
            </p>
          </div>
          <div className="w-60 max-w-full">
            <Select
              value={selected?.id ?? ""}
              onValueChange={setChosen}
              disabled={!agents.data?.length}
              items={agents.data?.map((agent) => ({ value: agent.id, label: agent.name })) ?? []}
            >
              <SelectTrigger aria-label={gt("Bot preferences target")}>
                <SelectValue placeholder={gt("Choose a bot")} />
              </SelectTrigger>
              <SelectPopup>
                {agents.data?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
      )}
      {agents.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <p className="min-w-0 flex-1">{agents.error}</p>
          <Button size="sm" variant="outline" onClick={agents.refresh}>
            <T>Try again</T>
          </Button>
        </div>
      )}
      {selected ? (
        <SourceAgentSettings
          key={selected.id}
          layout="page"
          environmentId={environmentId}
          hostId={hostId}
          agent={selected}
          onClose={() =>
            void navigate({
              to: "/settings/bots",
              hash: "bot-host-general",
              search: { machine: environmentId },
            })
          }
          onManageProviders={() =>
            void navigate({
              to: "/settings/bots",
              hash: "bot-host-providers",
              search: { machine: environmentId },
            })
          }
        />
      ) : (
        !agents.isPending &&
        !agents.error && (
          <div className="flex items-center gap-3 rounded-xl border border-border/60 p-5 text-sm text-muted-foreground">
            <BotIcon aria-hidden className="size-5" />
            <T>No bots on this computer yet. Create one from the Bots workspace.</T>
          </div>
        )
      )}
    </div>
  );
}

function BotSettingsLoading() {
  const gt = useGT();
  return (
    <div role="status" aria-label={gt("Loading bot settings")} className="space-y-4">
      <span className="sr-only">
        <T>Loading bot settings…</T>
      </span>
      <Skeleton className="h-5 w-40" />
      <div className="space-y-3 rounded-xl border border-border/60 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
