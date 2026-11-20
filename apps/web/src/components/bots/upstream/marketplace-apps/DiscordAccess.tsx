/* oxlint-disable shadcn/no-unknown-classes -- Source SlackIntegrationPanel DiscordAccessRow/DiscordRolesDialog. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useState } from "react";
import * as Schema from "effect/Schema";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { readPreparedConnection } from "../../../../state/session";
import { useEnvironmentQuery } from "../../../../state/query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SourceButton,
} from "../settings/SettingsParts";
import { useAgentSettingsValue } from "../settings/agent-settings-api";
import { t } from "../vault/connector-text";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import type { McpExecute } from "./SourceMcpRelay";
const Role = Schema.Struct({ id: Schema.String, name: Schema.String });
const decodeAccess = Schema.decodeUnknownSync(Schema.Struct({ allowedRoles: Schema.Array(Role) }));
const decodeRoles = Schema.decodeUnknownSync(Schema.Struct({ roles: Schema.Array(Role) }));
export function DiscordAccess(props: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  connections: readonly { workspaceId: string; workspaceName: string }[];
  execute: McpExecute;
}) {
  const registry = useContext(RegistryContext),
    connection = readPreparedConnection(props.environmentId),
    command = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const supported = settingsCapabilities(compatibility.data).includes("discord-access-v1");
  const permission = useAtomValue(
    openbot.settingsRead.permissionAtom(props.environmentId, {
      hostId: props.hostId,
      request: {
        operation: "settings.discord-access.access",
        parameters: { workspaceId: props.connections[0]?.workspaceId ?? "permission-check" },
      },
    }),
  );
  const read = async (
    operation: "settings.discord-access.access" | "settings.discord-access.roles",
    workspaceId: string,
  ) => {
    const request = { operation, parameters: { workspaceId } };
    if (!connection || readPreparedConnection(props.environmentId) !== connection)
      throw new Error("The host session changed.");
    if (
      !registry.get(
        openbot.settingsRead.permissionAtom(props.environmentId, { hostId: props.hostId, request }),
      )
    )
      throw new Error("You do not have permission to view Discord roles.");
    const result = await command({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (readPreparedConnection(props.environmentId) !== connection)
      throw new Error("The host session changed.");
    return result.value;
  };
  const c = useAgentSettingsValue<Record<string, readonly (typeof Role.Type)[]>>(
    async () =>
      Object.fromEntries(
        await Promise.all(
          props.connections.map(
            async (row) =>
              [
                row.workspaceId,
                decodeAccess(await read("settings.discord-access.access", row.workspaceId))
                  .allowedRoles,
              ] as const,
          ),
        ),
      ),
    supported && permission ? JSON.stringify(props.connections.map((row) => row.workspaceId)) : "",
  );
  const [editing, setEditing] = useState<{
      id: string;
      name: string;
      roles: readonly (typeof Role.Type)[];
      selected: readonly string[];
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const edit = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const roles = decodeRoles(await read("settings.discord-access.roles", id)).roles,
        held = c.value?.[id] ?? [];
      setEditing({
        id,
        name,
        roles: [...roles, ...held.filter((role) => !roles.some((row) => row.id === role.id))],
        selected: held.map((role) => role.id),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read roles.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={t("connector.discord.accessTitle")}
      description={t("connector.discord.accessDescription")}
    >
      <SettingsCard>
        {props.connections.map((row) => {
          const held = c.value?.[row.workspaceId];
          return (
            <SettingsRow
              key={row.workspaceId}
              title={row.workspaceName}
              description={
                !supported
                  ? t("connector.discord.accessHostUpdate", { host: props.hostName })
                  : held
                    ? held.length
                      ? held.map((role) => role.name).join(", ")
                      : t("connector.discord.accessEveryone")
                    : "Reading access…"
              }
            >
              {supported && (
                <SourceButton
                  disabled={busy || !held || !permission}
                  onClick={() => void edit(row.workspaceId, row.workspaceName)}
                >
                  {t("connector.discord.accessChoose")}
                </SourceButton>
              )}
            </SettingsRow>
          );
        })}
        {(error || c.error) && (
          <p className="integration-card-note" role="alert">
            {error ?? c.error}
          </p>
        )}
      </SettingsCard>
      <SourceConfirmDialog
        open={editing !== null}
        tone="default"
        title={t("connector.discord.accessDialogTitle", { workspace: editing?.name ?? "" })}
        description={t("connector.discord.accessDialogDescription")}
        confirmLabel={t("connector.discord.accessSave")}
        pending={busy}
        error={error}
        onCancel={() => setEditing(null)}
        onConfirm={async () => {
          if (!editing) return;
          setBusy(true);
          setError(null);
          try {
            await props.execute({
              operation: "settings.discord-access.update",
              parameters: {
                workspaceId: editing.id,
                allowedRoles: editing.roles
                  .filter((role) => editing.selected.includes(role.id))
                  .map((role) => ({ id: role.id, name: role.name })),
              },
            });
            setEditing(null);
            await c.refresh();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save Discord access.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <ul className="discord-roles">
          {editing?.roles.map((role) => (
            <li key={role.id}>
              <label className="discord-role-row">
                <input
                  type="checkbox"
                  checked={editing.selected.includes(role.id)}
                  disabled={
                    busy || (!editing.selected.includes(role.id) && editing.selected.length >= 50)
                  }
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      selected: event.target.checked
                        ? [...editing.selected, role.id]
                        : editing.selected.filter((id) => id !== role.id),
                    })
                  }
                />
                <span className="discord-role-name">{role.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {editing?.roles.length === 0 && <p>{t("connector.discord.accessNoRoles")}</p>}
      </SourceConfirmDialog>
    </SettingsSection>
  );
}
