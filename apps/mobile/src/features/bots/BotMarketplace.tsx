import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotSettingsRequest } from "@t3tools/contracts";
import { templateIsRead } from "@t3tools/contracts/openbot-templates";
import {
  CATEGORY_LABELS,
  decodeAgentPage,
  decodeInstalled,
  decodeSkill,
  decodeSkillPage,
  type Category,
  type Listing,
  type SkillDetail,
} from "@t3tools/client-runtime/openbot/marketplace";
import {
  settingIsRead,
  settingRequest,
  type SettingsActions,
} from "@t3tools/client-runtime/openbot/settings";
import {
  decodeTemplateAgents,
  templateHistoryRequest,
  templateInstall,
  type TemplateActions,
} from "@t3tools/client-runtime/openbot/templates";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "expo-crypto";
import * as Option from "effect/Option";
import type { Json } from "effect/Schema";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Picker } from "../settings/BotConnectionControls";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useBotTemplates } from "../settings/useBotTemplates";
import { BotAvatar } from "./upstream/BotAvatar";

type Scope = { environmentId: EnvironmentId; hostId: string };
type Tab = "agents" | "skills";
const tabs = [
  { value: "agents", label: "Agents" },
  { value: "skills", label: "Skills" },
] as const;
const listCategories = Object.entries(CATEGORY_LABELS).map(([id, name]) => ({ id, name }));
const agentList = { operation: "agent.list" } as const;

export function BotMarketplace(scope: Scope) {
  const { environmentId, hostId } = scope;
  const registry = useContext(RegistryContext);
  const settings = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const readTemplate = useAtomCommand(openbot.templateRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = environmentSession.preparedConnectionValueAtom(environmentId);
  const agents = useEnvironmentQuery(
    openbot.readFromHost({ environmentId, input: { hostId, request: agentList } }),
  );
  const canBrowse = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.local-catalog.searchAgents", parameters: {} },
    }),
  );
  const capture = () => {
    const current = Option.getOrNull(appAtomRegistry.get(connection));
    if (!current) throw new Error("Reconnect to this server to use Marketplace.");
    return () => {
      if (Option.getOrNull(appAtomRegistry.get(connection)) !== current)
        throw new Error("The server connection changed. Open Marketplace again.");
    };
  };
  const actions: SettingsActions = {
    can: (request) =>
      registry.get(
        (settingIsRead(request) ? openbot.settingsRead : openbot.adminToHost).permissionAtom(
          environmentId,
          { hostId, request },
        ),
      ),
    execute: async (request) => {
      const check = capture();
      const result = settingIsRead(request)
        ? await settings({ environmentId, input: { hostId, request } })
        : await admin({ environmentId, input: { hostId, request } });
      check();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
  };
  const templates: TemplateActions = {
    can: (request) =>
      registry.get(
        (templateIsRead(request) ? openbot.templateRead : openbot.adminToHost).permissionAtom(
          environmentId,
          { hostId, request },
        ),
      ),
    execute: async (request) => {
      const check = capture();
      const result = templateIsRead(request)
        ? await readTemplate({ environmentId, input: { hostId, request } })
        : await admin({ environmentId, input: { hostId, request } });
      check();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (!templateIsRead(request)) agents.refresh();
      return result.value;
    },
  };
  if (!canBrowse) return <Text>You need settings access to browse this server’s catalog.</Text>;
  return (
    <MarketplacePanel
      key={JSON.stringify([environmentId, hostId])}
      scope={scope}
      actions={actions}
      templates={templates}
      agents={decodeTemplateAgents(agents.data)}
    />
  );
}

type Agent = ReturnType<typeof decodeTemplateAgents>[number];
type CatalogRead = (
  operation: OpenbotSettingsRequest["operation"],
  parameters: Json,
) => Promise<unknown>;
function contextRead(actions: SettingsActions): CatalogRead {
  return async (operation, parameters) => {
    const request = settingRequest(operation, parameters);
    if (!request || !actions.can(request))
      throw new Error("This server does not allow that catalog action.");
    return actions.execute(request);
  };
}

function MarketplacePanel({
  scope,
  actions,
  templates,
  agents,
}: {
  scope: Scope;
  actions: SettingsActions;
  templates: TemplateActions;
  agents: readonly Agent[];
}) {
  const [tab, setTab] = useState<Tab>("agents");
  const [text, setText] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [selection, setSelection] = useState<Listing | null>(null);
  const query = useDebouncedValue(text.trim(), 160);
  const requestKey = JSON.stringify([tab, query, category]);
  const [page, setPage] = useState<{
    key: string;
    rows: readonly Listing[];
    next: string | null;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; detail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const run = contextRead(actions);
  const read = async (cursor?: string) => {
    const ticket = ++generation.current;
    setLoading(true);
    setFailure(null);
    const parameters = {
      query,
      sort: "name",
      limit: 50,
      ...(category === "all" ? {} : { category }),
      ...(cursor ? { cursor } : {}),
    };
    await (async () => {
      const value = await run(
        tab === "agents"
          ? "settings.local-catalog.searchAgents"
          : "settings.local-catalog.searchSkills",
        parameters,
      );
      if (generation.current !== ticket) return;
      const parsed = tab === "agents" ? decodeAgentPage(value) : decodeSkillPage(value);
      const rows: Listing[] =
        "agents" in parsed
          ? parsed.agents.map((entry) => ({ kind: "agent", value: entry }))
          : parsed.skills.map((entry) => ({ kind: "skill", value: entry }));
      setPage((previous) => ({
        key: requestKey,
        rows:
          cursor && previous?.key === requestKey
            ? [
                ...previous.rows,
                ...rows.filter(
                  (row) => !previous.rows.some((item) => item.value.id === row.value.id),
                ),
              ]
            : rows,
        next: parsed.nextCursor,
      }));
    })()
      .catch((cause) => {
        if (generation.current === ticket)
          setFailure({
            key: requestKey,
            detail: cause instanceof Error ? cause.message : "Could not load the catalog.",
          });
      })
      .finally(() => {
        if (generation.current === ticket) setLoading(false);
      });
  };
  const load = useEffectEvent((key: string) => {
    if (key === requestKey) void read();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the current host catalog page, cancelling stale updates when its search or category changes.
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) load(requestKey);
    });
    return () => {
      mounted = false;
      generation.current += 1;
    };
  }, [requestKey]);
  const current = page?.key === requestKey ? page : null;
  const error = failure?.key === requestKey ? failure.detail : null;
  const rows = current?.rows ?? [];
  const scopeKey = JSON.stringify([scope.environmentId, scope.hostId]);
  return selection ? (
    <View className="gap-4">
      <Button tone="text" label="Back to Marketplace" onPress={() => setSelection(null)} />
      <Text className="text-2xl font-t3-semibold">{selection.value.name}</Text>
      <Text className="text-foreground-muted">{selection.value.creatorName}</Text>
      <Text>{selection.value.description}</Text>
      {selection.kind === "agent" ? (
        <AgentListing
          key={selection.value.id}
          listing={selection}
          scopeKey={scopeKey}
          actions={templates}
          agents={agents}
        />
      ) : (
        <SkillListing
          key={selection.value.id}
          listing={selection}
          actions={actions}
          agents={agents}
        />
      )}
    </View>
  ) : (
    <View className="gap-4">
      <SegmentedControl selected={tab} options={tabs} onSelect={setTab} />
      <AppTextInput
        accessibilityLabel="Search Marketplace"
        placeholder={tab === "agents" ? "Search agents" : "Search skills"}
        value={text}
        maxLength={256}
        onChangeText={setText}
        className="min-h-11 rounded-full bg-grouped-card px-4"
      />
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Picker
          label="Category"
          disabled={false}
          value={category}
          options={[{ id: "all", name: "All categories" }, ...listCategories]}
          onChange={(value) => {
            if (value === "all" || value in CATEGORY_LABELS) setCategory(value as Category | "all");
          }}
        />
        <Button
          tone="text"
          icon="arrow.clockwise"
          label="Refresh catalog"
          disabled={loading}
          onPress={() => void read()}
        />
      </View>
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {!current && !error && (
        <Text accessibilityRole="progressbar" className="text-foreground-muted">
          Loading catalog…
        </Text>
      )}
      {current && rows.length === 0 && !loading && (
        <Text className="text-foreground-muted">No matches</Text>
      )}
      {rows.length > 0 && (
        <SettingsSection title={tab === "agents" ? "Agents" : "Skills"}>
          {rows.map((row) => (
            <Pressable
              key={row.value.id}
              accessibilityRole="button"
              accessibilityLabel={row.value.name}
              onPress={() => setSelection(row)}
              className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
            >
              {row.kind === "agent" ? (
                <BotAvatar
                  seed={row.value.avatarSeed ?? row.value.id}
                  hue={row.value.avatarHue}
                  size={38}
                />
              ) : (
                <SymbolView
                  name="sparkles"
                  size={24}
                  tintColorClassName="accent-foreground-muted"
                />
              )}
              <View className="min-w-0 flex-1 gap-1">
                <Text className="font-t3-semibold" numberOfLines={1}>
                  {row.value.name}
                </Text>
                <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                  {row.kind === "agent"
                    ? row.value.title || row.value.description
                    : row.value.description}
                </Text>
              </View>
              <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
            </Pressable>
          ))}
          {current?.next && (
            <ListRow
              label="Load more"
              disabled={loading}
              onPress={() => void read(current.next ?? undefined)}
            />
          )}
        </SettingsSection>
      )}
    </View>
  );
}

function AgentListing({
  listing,
  scopeKey,
  actions,
  agents,
}: {
  listing: Extract<Listing, { kind: "agent" }>;
  scopeKey: string;
  actions: TemplateActions;
  agents: readonly Agent[];
}) {
  const c = useBotTemplates(scopeKey, actions);
  const [operationId, setOperationId] = useState(randomUUID);
  const review = { operation: "templates.listing" as const, listingId: listing.value.id };
  const available = actions.can(review);
  const load = useEffectEvent(() => void c.run(review));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Resolve this exact public listing and its pinned revision before enabling installation.
  useEffect(() => {
    if (available) load();
  }, [available]);
  const info =
    c.state.review?.kind === "marketplace" && c.state.review.detail.id === listing.value.id
      ? c.state.review.detail
      : null;
  const installed = agents.find((agent) => agent.listingId === listing.value.id);
  const request = info
    ? templateInstall(
        c.state,
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        operationId,
        installed && { agentId: installed.id, listingId: listing.value.id },
        true,
      )
    : null;
  const recovery = templateHistoryRequest(c.state);
  return (
    <>
      <SettingsSection title="Included">
        <View className="gap-2 px-4 py-3">
          {info?.skills.map((skill) => (
            <Text key={skill.slug}>{skill.name}</Text>
          ))}
          {info?.routines.map((routine) => (
            <Text key={routine.name}>
              {routine.name}
              {routine.active ? " (active)" : ""}
            </Text>
          ))}
          {!info && (
            <Text className="text-foreground-muted">
              {listing.value.skillCount} skills · {listing.value.routineCount} routines
            </Text>
          )}
        </View>
      </SettingsSection>
      {c.error && <Text accessibilityRole="alert">{c.error}</Text>}
      {c.state.notice && <Text accessibilityRole="status">{c.state.notice}</Text>}
      {c.state.uncertain ? (
        <Button
          label="Check installation status"
          disabled={c.busy || !actions.can(recovery)}
          onPress={() => void c.run(recovery)}
        />
      ) : (
        <Button
          label={installed ? "Update agent" : "Add agent"}
          disabled={c.busy || !request || !actions.can(request)}
          onPress={() => {
            if (!request || !info) return;
            Dialog.confirm({
              title: installed ? "Update this agent?" : "Add this agent?",
              message: `${listing.value.name} includes ${info.skills.length} skills and ${info.routines.length} routines.`,
              confirmText: installed ? "Update" : "Add agent",
              onConfirm: () =>
                void c.run(request).then((ok) => {
                  if (ok) setOperationId(randomUUID());
                }),
            });
          }}
        />
      )}
    </>
  );
}

function SkillListing({
  listing,
  actions,
  agents,
}: {
  listing: Extract<Listing, { kind: "skill" }>;
  actions: SettingsActions;
  agents: readonly Agent[];
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [agentId, setAgentId] = useState("");
  const [installed, setInstalled] = useState<{ agentId: string; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const installing = useRef(false);
  const whenReady = contextRead(actions);
  const load = useEffectEvent(async () => {
    let next: SkillDetail | null = null;
    try {
      next = decodeSkill(
        await whenReady("settings.local-catalog.skill", { skillId: listing.value.id }),
      );
    } catch {
      if (active.current) setError("Could not open this skill.");
      return;
    }
    if (next.id === listing.value.id && active.current) setDetail(next);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read this skill’s exact pinned version from the selected host.
  useEffect(() => {
    let mounted = true;
    active.current = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
      active.current = false;
    };
  }, []);
  const install =
    detail && agentId
      ? settingRequest("settings.skills-admin.install", {
          agentId,
          skillId: detail.id,
          versionId: detail.versionId,
        })
      : null;
  return (
    <>
      {detail && (
        <SettingsSection title="Skill details">
          <View className="gap-2 px-4 py-3">
            <Text>
              Version {detail.version} · {detail.files.length} files
            </Text>
            {detail.instructions && (
              <Text className="text-foreground-muted">{detail.instructions}</Text>
            )}
          </View>
        </SettingsSection>
      )}
      {agents.length > 0 && (
        <Picker
          label="Add to agent"
          disabled={busy}
          value={agentId}
          options={agents.map(({ id, name }) => ({ id, name }))}
          onChange={setAgentId}
        />
      )}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {installed?.agentId === agentId && (
        <Text accessibilityRole="status">Version {installed.version} installed</Text>
      )}
      <Button
        label="Add skill"
        disabled={busy || !install || !actions.can(install) || installed?.agentId === agentId}
        onPress={() => {
          if (!detail || !install || installing.current) return;
          installing.current = true;
          const selected = agentId;
          setError(null);
          setBusy(true);
          void actions
            .execute(install)
            .then(async () => {
              const skills = decodeInstalled(
                await whenReady("settings.skills-admin.list", { agentId: selected }),
              );
              const match = skills.find(({ skillId }) => skillId === detail.id);
              if (!match) throw new Error("The host did not confirm the installed skill.");
              if (active.current)
                setInstalled({ agentId: selected, version: match.installedVersion });
            })
            .catch(() => {
              if (active.current)
                setError("The skill install could not be confirmed. Check the agent’s skills.");
            })
            .finally(() => {
              installing.current = false;
              if (active.current) setBusy(false);
            });
        }}
      />
    </>
  );
}
