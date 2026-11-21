import { AsyncResult } from "effect/reactivity";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SourceHostMcpEnvironment } from "./SourceHostMcpEnvironment";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { useEnvironmentQuery } from "../../state/query";
import { randomUUID } from "../../lib/utils";
import { mcpAccountUrl } from "./upstream/marketplace-apps/mcp-accounts";
import { useBuiltinApps, Wizard } from "./upstream/marketplace-apps/BuiltinApps";
import { Lock } from "lucide-react";
import { openbot } from "../../state/openbot";
import { readPreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import type { MarketplaceApp } from "./upstream/marketplace/marketplace-model";
import {
  MARKETPLACE_PLUGINS,
  createPluginAppConfig,
} from "./upstream/marketplace-apps/plugin-catalog";
import type {
  MarketplacePluginApp,
  McpServerConfig,
} from "./upstream/marketplace-apps/plugin-model";
import { mcpFlowFields } from "./upstream/marketplace-apps/mcp-connect-flows";
import { PluginAppPage, type AppConnection } from "./upstream/marketplace-apps/PluginAppPage";
import { AppConnectDialog } from "./upstream/marketplace-apps/AppConnectDialog";
import { VaultConnectorEnvironment } from "./upstream/vault/VaultConnectorEnvironment";
import { OnePasswordMark } from "./upstream/vault/OnePasswordMark";
import { useGT } from "gt-react";
const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      enabled: Schema.Boolean,
      transport: Schema.String,
      url: Schema.String,
    }),
  ),
);
const decodeMatches = Schema.decodeUnknownSync(
  Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({
        appId: Schema.String,
        mcpServerIds: Schema.Array(Schema.String),
        accountMcpServerIds: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
);
const decodeSignIns = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      mcpServerId: Schema.String,
      signedIn: Schema.Boolean,
      needsSignIn: Schema.optional(Schema.Boolean),
    }),
  ),
);
const decodeVault = Schema.decodeUnknownSync(Schema.Struct({ state: Schema.String }));
const catalogRequest = {
  operation: "mcp.catalogMatches",
  apps: MARKETPLACE_PLUGINS.flatMap((plugin) =>
    plugin.apps.map((app) =>
      app.server.transport === "http"
        ? {
            id: app.id,
            name: app.server.name,
            transport: "http" as const,
            url: app.server.url,
            userLink: (app.server.auth ?? []).some((flow) =>
              mcpFlowFields(flow).some((field) => field.url),
            ),
          }
        : {
            id: app.id,
            name: app.server.name,
            transport: "stdio" as const,
            command: app.server.command,
            args: app.server.args,
          },
    ),
  ),
} satisfies OpenbotAdminRequest;
export function useSourceMarketplaceApps({
  environmentId,
  hostId,
  hostName = "Host",
  onPrompt,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  onPrompt?: ((prompt: string) => void) | undefined;
}) {
  const gt = useGT();
  const registry = useContext(RegistryContext),
    admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = readPreparedConnection(environmentId),
    scope = `${environmentId}:${hostId}`;
  const active = useRef(true),
    [held, setHeld] = useState<{
      scope: string;
      connection: typeof connection;
      rows: ReturnType<typeof decodeRows>;
      connections: Record<string, AppConnection[]>;
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [target, setTarget] = useState<{
      scope: string;
      connection: typeof connection;
      app: MarketplacePluginApp;
      id?: string;
      config?: McpServerConfig;
    } | null>(null),
    [vault, setVault] = useState<Record<string, string>>({}),
    [createCustom, setCreateCustom] = useState(false);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const supportsAccounts = settingsCapabilities(compatibility.data).includes("mcp-accounts-v1");
  const changes = useAtomValue(openbot.changes({ environmentId, input: {} }));
  const change = AsyncResult.getOrElse(changes, () => null);
  const revision =
    change &&
    (change.hostId === null || change.hostId === hostId) &&
    ["all", "configuration"].includes(change.resource)
      ? changes
      : null;
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "mcp.list" },
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Ignore host replies after the owning Marketplace closes.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const execute = async (request: OpenbotAdminRequest) => {
    if (!connection || !active.current || readPreparedConnection(environmentId) !== connection)
      throw new Error("Reconnect the original host session.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You do not have permission to manage apps.");
    const result = await admin({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (!active.current || readPreparedConnection(environmentId) !== connection)
      throw new Error("The original host session changed.");
    return result.value;
  };
  const builtins = useBuiltinApps({
    environmentId,
    hostId,
    hostName,
    execute,
    allowed: canManage,
    revision,
  });
  const refresh = async () => {
    try {
      const [rawRows, rawMatches, rawSignIns] = await Promise.all([
        execute({ operation: "mcp.list" }),
        execute(catalogRequest),
        execute({ operation: "mcp.signIn.list" }),
      ]);
      const rows = decodeRows(rawRows),
        matches = decodeMatches(rawMatches),
        signIns = decodeSignIns(rawSignIns),
        connections: Record<string, AppConnection[]> = {};
      for (const match of matches.matches)
        connections[match.appId] = match.mcpServerIds.flatMap((id) => {
          const row = rows.find((row) => row.id === id);
          if (!row) return [];
          const signIn = signIns.find((entry) => entry.mcpServerId === id);
          return [
            {
              id,
              name: row.name,
              enabled: row.enabled,
              needsSignIn: signIn?.needsSignIn ?? false,
              account: match.accountMcpServerIds?.includes(id) ?? false,
            },
          ];
        });
      setHeld({ scope, connection, rows, connections });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : gt("Could not load app connections."));
    }
  };
  const load = useEffectEvent(async () => {
    await refresh();
    const values = await Promise.allSettled(
      (["onepassword", "bitwarden"] as const).map(async (connector) => ({
        connector,
        state: decodeVault(
          await execute({
            operation:
              connector === "onepassword" ? "vault.onepassword.status" : "vault.bitwarden.status",
          }),
        ).state,
      })),
    );
    const next: Record<string, string> = {};
    for (const result of values)
      if (result.status === "fulfilled") next[result.value.connector] = result.value.state;
    if (active.current) setVault(next);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read external host state for the active scope.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load resumes after guarded host reads, not synchronous state mirroring.
    if (canManage) void load();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A host/session change invalidates the external read even when permissions stay equal.
  }, [canManage, scope, connection, revision]);
  const current = held?.scope === scope && held.connection === connection ? held : null;
  const apps: MarketplaceApp[] = MARKETPLACE_PLUGINS.map((plugin) => {
    const connected = plugin.apps.every((app) => (current?.connections[app.id]?.length ?? 0) > 0),
      needsAttention = plugin.apps.some((app) =>
        current?.connections[app.id]?.some((row) => !row.enabled || row.needsSignIn),
      );
    const status: MarketplaceApp["status"] =
      !current || error
        ? "attention"
        : target?.scope === scope && plugin.apps.some((app) => app.id === target.app.id)
          ? "connecting"
          : needsAttention
            ? "attention"
            : connected
              ? "connected"
              : "idle";
    const connect = async (appId?: string, id?: string) => {
      const app =
        plugin.apps.find((app) => app.id === appId) ??
        plugin.apps.find((app) => !current?.connections[app.id]?.length) ??
        plugin.apps[0];
      if (!app || !current || !canManage || error) return;
      const heldId = id ?? current.connections[app.id]?.[0]?.id;
      if (
        !heldId &&
        current.rows.some((row) => row.name.toLowerCase() === app.server.name.toLowerCase())
      ) {
        setError(
          gt(
            "Another connection already uses the name {name}. Rename it in MCP settings before connecting this app.",
            { name: app.server.name },
          ),
        );
        return;
      }
      setTarget({ scope, connection, app, ...(heldId ? { id: heldId } : {}) });
    };
    return {
      id: plugin.id,
      name: plugin.name,
      tagline: plugin.tagline,
      category: plugin.category,
      ...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : {}),
      status,
      connect: async () => connect(),
      detail: (
        <PluginAppPage
          plugin={plugin}
          status={status}
          connections={current?.connections ?? {}}
          canManage={canManage && Boolean(current)}
          error={!canManage ? gt("You do not have permission to manage apps.") : error}
          onConnect={connect}
          onRefresh={refresh}
          onPrompt={onPrompt}
          canAddAccount={supportsAccounts}
          onAddAccount={async (appId) => {
            const app = plugin.apps.find((app) => app.id === appId);
            if (
              !app ||
              !current ||
              !supportsAccounts ||
              app.server.transport !== "http" ||
              app.server.auth?.[0]?.kind !== "link"
            )
              return;
            const names = new Set(current.rows.map((row) => row.name.toLocaleLowerCase()));
            let count = 2;
            while (names.has(`${app.name} ${count}`.toLocaleLowerCase())) count++;
            const base = createPluginAppConfig(app);
            setTarget({
              scope,
              connection,
              app,
              config: {
                ...base,
                name: `${app.name} ${count}`,
                url: mcpAccountUrl(base.url, randomUUID()),
              },
            });
          }}
          onRename={async (id, name) => {
            if (
              !Object.values(current?.connections ?? {}).some((rows) =>
                rows.some((row) => row.id === id && row.account),
              )
            )
              throw new Error("Only added account labels can be changed.");
            await execute({
              operation: "mcp.updateById",
              mcpServerId: id,
              patch: { name: name.trim() },
            });
            await refresh();
          }}

          onRemove={async (ids) => {
            for (const mcpServerId of ids) await execute({ operation: "mcp.delete", mcpServerId });
            await refresh();
          }}
          onToggle={async (mcpServerId, enabled) => {
            await execute({ operation: "mcp.toggle", mcpServerId, enabled });
            await refresh();
          }}
        />
      ),
    };
  });
  apps.unshift(...builtins.apps);
  const matched = new Set(
    Object.values(current?.connections ?? {}).flatMap((rows) => rows.map((row) => row.id)),
  );
  for (const row of current?.rows ?? [])
    if (!matched.has(row.id))
      apps.push({
        id: `custom:${row.id}`,
        name: row.name,
        tagline: "Custom MCP server",
        category: "other",
        status: row.enabled ? "connected" : "idle",
        detail: (
          <SourceHostMcpEnvironment
            environmentId={environmentId}
            hostId={hostId}
            hostName={hostName}
            initialServerId={row.id}
          />
        ),
      });
  for (const connector of ["onepassword", "bitwarden"] as const)
    apps.push({
      id: connector,
      name: connector === "onepassword" ? "1Password" : "Bitwarden",
      tagline:
        connector === "onepassword"
          ? "Sign in to sites with logins you share"
          : "Sign in to sites with logins from a shared folder",
      category: "productivity",
      icon: connector === "onepassword" ? <OnePasswordMark /> : <Lock />,
      status:
        vault[connector] === "connected"
          ? "connected"
          : vault[connector] === "connecting"
            ? "connecting"
            : vault[connector]
              ? "idle"
              : "attention",
      detail: (
        <VaultConnectorEnvironment
          environmentId={environmentId}
          hostId={hostId}
          hostName={hostName}
          connector={connector}
        />
      ),
    });
  return {
    apps,
    onAddApp: () => setCreateCustom(true),
    ...(error ? { appsError: error } : {}),
    appsOverlay: (
      <>
        {builtins.overlay}
        {createCustom && (
          <Wizard
            title={gt("Add app")}
            description={gt("Connect a custom MCP server to this host.")}
            close={() => {
              setCreateCustom(false);
              void refresh();
            }}
          >
            <SourceHostMcpEnvironment
              environmentId={environmentId}
              hostId={hostId}
              hostName={hostName}
              initialCreate
            />
          </Wizard>
        )}

        {target && target.scope === scope && target.connection === connection ? (
          <AppConnectDialog
            key={`${scope}:${target.app.id}:${target.id ?? "new"}`}
            app={target.app}
            hostName={hostName}
            {...(target.id ? { mcpServerId: target.id } : {})}
            {...(target.config ? { initialConfig: target.config } : {})}
            execute={execute}
            onClose={() => {
              setTarget(null);
              void refresh();
            }}
            onSaved={refresh}
          />
        ) : null}
      </>
    ),
  };
}
