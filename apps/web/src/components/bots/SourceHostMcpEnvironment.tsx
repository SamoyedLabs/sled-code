/* oxlint-disable shadcn/no-unknown-classes -- Source MCP integration wizard uses the imported integration-layout stylesheet. */
/* oxlint-disable react/no-unstable-nested-components -- signIn is an invoked render callback, not a component type. */
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { randomUUID } from "../../lib/utils";
import * as Schema from "effect/Schema";
import { type EnvironmentId, OpenbotMcpConfig } from "@t3tools/contracts";
import { ServerMcpPanel } from "./upstream/settings/ServerMcpPanel";
import {
  type McpServerConfig,
  emptyMcpConfig,
  normalizeMcpConfig,
  mcpConfigIsValid,
} from "./upstream/settings/mcp-model";
import { useAgentSettingsValue } from "./upstream/settings/agent-settings-api";
import { useSourceSettingsAdmin } from "./upstream/settings/useSourceSettingsAdmin";
import { SourceMcpRelay } from "./upstream/marketplace-apps/SourceMcpRelay";
import { retainedMcpPatch } from "./upstream/settings/mcp-patch";
import { SourceButton } from "./upstream/settings/SettingsParts";
const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      transport: Schema.Literals(["stdio", "http"]),
      enabled: Schema.Boolean,
      url: Schema.String,
      command: Schema.String,
      argsCount: Schema.Number,
      envNames: Schema.Array(Schema.String),
      headerNames: Schema.Array(Schema.String),
      workingDirectory: Schema.String,
      envPassthrough: Schema.Array(Schema.String),
    }),
  ),
);
const decodeConfig = Schema.decodeUnknownSync(OpenbotMcpConfig);
const decodeTest = Schema.decodeUnknownSync(
  Schema.Struct({ toolCount: Schema.Number, error: Schema.NullOr(Schema.String) }),
);
function projectedConfig(row: ReturnType<typeof decodeRows>[number]): McpServerConfig {
  return {
    ...emptyMcpConfig(),
    id: row.id,
    name: row.name,
    transport: row.transport,
    enabled: row.enabled,
    url: row.url,
    command: row.command,
    workingDirectory: row.workingDirectory,
    envPassthrough: [...row.envPassthrough],
    args: [],
    env: [],
    headers: [],
    retained: { args: row.argsCount, env: row.envNames, headers: row.headerNames },
  };
}
export function SourceHostMcpEnvironment(props: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  initialServerId?: string | undefined;
  initialCreate?: boolean | undefined;
}) {
  const host = useSourceSettingsAdmin(props.environmentId, props.hostId);
  const [scope, setScope] = useState({ connection: host.connection, epoch: 0 });
  if (scope.connection !== host.connection)
    setScope({ connection: host.connection, epoch: scope.epoch + 1 });
  return <Ready key={`${props.environmentId}:${props.hostId}:${scope.epoch}`} {...props} />;
}
function Ready({
  environmentId,
  hostId,
  hostName = "this host",
  initialServerId,
  initialCreate,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  initialServerId?: string | undefined;
  initialCreate?: boolean | undefined;
}) {
  const host = useSourceSettingsAdmin(environmentId, hostId);
  const c = useAgentSettingsValue(
    async () => decodeRows(await host.execute({ operation: "mcp.list" })).map(projectedConfig),
    hostId,
  );
  const [relay, setRelay] = useState<McpServerConfig | null>(null);
  const [panelEpoch, setPanelEpoch] = useState(0);
  const save = async (config: McpServerConfig) => {
    const baseline = c.value?.find((row) => row.id === config.id);
    if (baseline)
      await host.execute({
        operation: "mcp.updateById",
        mcpServerId: config.id,
        patch: retainedMcpPatch(config, baseline),
      });
    else
      await host.execute({
        operation: "mcp.save",
        config: decodeConfig(normalizeMcpConfig(config)),
      });
    await c.refresh();
  };
  return (
    <>
      <ServerMcpPanel
        key={panelEpoch}
        servers={c.value}
        initialServerId={panelEpoch === 0 ? initialServerId : undefined}
        initialCreate={panelEpoch === 0 ? initialCreate : undefined}
        loadError={c.error}
        canManage={host.can({ operation: "mcp.save", config: emptyMcpConfig() })}
        onRetryLoad={() => void c.refresh()}
        onSave={save}
        onRemove={async (id) => {
          await host.execute({ operation: "mcp.delete", mcpServerId: id });
          await c.refresh();
        }}
        onSetEnabled={async (id, enabled) => {
          await host.execute({ operation: "mcp.toggle", mcpServerId: id, enabled });
          await c.refresh();
        }}
        onTest={async (config) => {
          const baseline = c.value?.find((row) => row.id === config.id);
          return decodeTest(
            await host.execute(
              baseline
                ? {
                    operation: "mcp.testPatchById",
                    mcpServerId: config.id,
                    patch: retainedMcpPatch(config, baseline),
                  }
                : { operation: "mcp.test", config: decodeConfig(normalizeMcpConfig(config)) },
            ),
          );
        }}
        signIn={(config) =>
          config.transport === "http" ? (
            <SourceButton
              variant="ghost"
              disabled={
                !mcpConfigIsValid(config) ||
                !host.can(
                  config.retained
                    ? { operation: "mcp.signInRelay.startById", mcpServerId: config.id }
                    : { operation: "mcp.signInRelay.start", config },
                ) ||
                (config.retained !== undefined &&
                  Object.keys(
                    retainedMcpPatch(
                      config,
                      c.value?.find((row) => row.id === config.id) ?? config,
                    ),
                  ).length > 0)
              }
              onClick={() => setRelay({ ...config, id: config.id || `mcp-${randomUUID()}` })}
            >
              Sign in
            </SourceButton>
          ) : null
        }
      />
      {relay && (
        <Dialog.Root open>
          <Dialog.Portal>
            <div className="openbot-react">
              <Dialog.Viewport className="integration-dialog-backdrop">
                <Dialog.Popup className="integration-wizard-dialog">
                  <div className="integration-wizard">
                    <header className="integration-wizard-head">
                      <Dialog.Title>Connect {relay.name}</Dialog.Title>
                      <Dialog.Description>
                        Sign in to use this MCP server on {hostName}.
                      </Dialog.Description>
                    </header>
                    <div className="integration-wizard-body">
                      <SourceMcpRelay
                        name={relay.name}
                        hostName={hostName}
                        {...(relay.retained ? { mcpServerId: relay.id } : { config: relay })}
                        execute={host.execute}
                        onCancel={() => setRelay(null)}
                        onConnected={async () => {
                          if (!relay.retained) await save(relay);
                          else await c.refresh();
                          setRelay(null);
                          setPanelEpoch((value) => value + 1);
                        }}
                      />
                    </div>
                  </div>
                </Dialog.Popup>
              </Dialog.Viewport>
            </div>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
