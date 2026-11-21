import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  OpenbotVaultItem,
  OpenbotVaultRequest,
  OpenbotVaultVersion,
} from "@t3tools/contracts";
import {
  vaultFields,
  vaultPrivateFields,
  vaultSecretFields,
  vaultDraft,
  vaultSaveRequest,
  vaultLabel,
  workflowAgents,
  type VaultKind,
} from "@t3tools/client-runtime/openbot/presentation";
import { useBotVault, type VaultController } from "./useBotVault";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { isForegroundHandoffActive } from "../../lib/foreground-handoff";
import { BotVaultCodePanel, BotVaultTwoStepSetup, type BotVaultCode } from "./BotVaultTwoStep";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { AppState, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Clipboard from "expo-clipboard";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { Picker } from "./BotConnectionControls";
import { T, Var, useGT } from "gt-react-native";
export function BotVaultEntry(scope: { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: scope.environmentId,
      input: { hostId: scope.hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(scope.environmentId, {
      hostId: scope.hostId,
      request: { operation: "vault.list", version: "v1" },
    }),
  );
  if (!canManage || !settingsCapabilities(compatibility.data).includes("vault-v1")) return null;
  return (
    <>
      <SettingsSection title={gt("Vault")}>
        <ListRow
          icon="lock"
          label={gt("Vault and password managers")}
          onPress={() => setOpen(true)}
        />
      </SettingsSection>
      {open && (
        <Sheet title={gt("Vault")} onClose={() => setOpen(false)}>
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="px-5 pb-6 pt-4"
          >
            <BotVault {...scope} />
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}

export function BotVault({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  return (
    <VaultHost key={`${environmentId}:${hostId}`} environmentId={environmentId} hostId={hostId} />
  );
}
function VaultHost({ environmentId, hostId }: { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const caps = settingsCapabilities(compatibility.data);
  const version = caps.includes("vault-v4")
    ? "v4"
    : caps.includes("vault-v3")
      ? "v3"
      : caps.includes("vault-v2")
        ? "v2"
        : "v1";
  const controller = useBotVault(async (request) => {
    const result = await admin({ environmentId, input: { hostId, request } });
    return result._tag === "Failure"
      ? { ok: false, error: gt("Vault request failed.") }
      : { ok: true, value: result.value };
  });
  if (compatibility.isPending)
    return (
      <Text>
        <T>Opening vault…</T>
      </Text>
    );
  return (
    <VaultPanel
      key={`${environmentId}:${hostId}:${version}`}
      controller={controller}
      version={version}
      environmentId={environmentId}
      hostId={hostId}
    />
  );
}
type Authority = { environmentId: EnvironmentId; hostId: string };
function Action({
  request,
  label,
  disabled,
  onAction,
  ...authority
}: Authority & {
  request: OpenbotVaultRequest;
  label: string;
  disabled: boolean;
  onAction: () => void;
}) {
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(authority.environmentId, {
      hostId: authority.hostId,
      request,
    }),
  );
  return <Button label={label} disabled={disabled || !allowed} onPress={onAction} />;
}
function VaultPanel({
  controller: c,
  version,
  ...authority
}: Authority & { controller: VaultController; version: OpenbotVaultVersion }) {
  const gt = useGT();
  const hasTwoStep = version === "v3" || version === "v4";
  const agentQuery = useEnvironmentQuery(
    version === "v4"
      ? openbot.readFromHost({
          environmentId: authority.environmentId,
          input: { hostId: authority.hostId, request: { operation: "agent.list" } },
        })
      : null,
  );
  const [selection, setSelection] = useState<OpenbotVaultItem | null>(null);
  const [kind, setKind] = useState<VaultKind>("login");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [epoch, setEpoch] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const secrets = useRef<Record<string, string>>({});
  const [setup, setSetup] = useState(false);
  const [keyChange, setKeyChange] = useState<"keep" | "update" | "remove">("keep");
  const [agentScope, setAgentScope] = useState<readonly string[] | null | undefined>(undefined);
  const [accessOpen, setAccessOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState<BotVaultCode | null>(null);
  const codeGeneration = useRef(0);
  const clear = () => {
    secrets.current = {};
    setKeyChange("keep");
    setSetup(false);
    setCodeOpen(false);
    setCode(null);
    codeGeneration.current += 1;
    setEpoch((v) => v + 1);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clear private native input buffers before the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && !isForegroundHandoffActive()) {
        secrets.current = {};
        setKeyChange("keep");
        setSetup(false);
        setCodeOpen(false);
        setCode(null);
        codeGeneration.current += 1;
        setAgentScope(undefined);
        setAccessOpen(false);
        setEpoch((v) => v + 1);
        setSelection(null);
      }
    });
    return () => subscription.remove();
  }, []);
  const choose = (item: OpenbotVaultItem | null) => {
    clear();
    setSelection(item);
    setFields(vaultDraft(item));
    setKind(item?.kind ?? "login");
    setAgentScope(undefined);
    setAccessOpen(false);
    setConfirmDelete(false);
  };
  const run = (request: OpenbotVaultRequest) => {
    clear();
    return c.run(request);
  };
  const save = () => {
    const request = vaultSaveRequest(
      kind,
      selection?.id ?? null,
      fields,
      secrets.current,
      version,
      {
        ...(keyChange === "update"
          ? { twoStepKey: secrets.current.twoStepKey }
          : keyChange === "remove"
            ? { twoStepKey: "" }
            : {}),
        ...(agentScope === undefined ? {} : { agents: agentScope }),
      },
    );
    clear();
    if (request === null) {
      setLocalError(gt("Check the item fields and try again."));
      return;
    }
    setLocalError(null);
    void c.run(request).then((ok) => {
      if (ok) choose(null);
    });
  };
  const [localError, setLocalError] = useState<string | null>(null);
  const canLoad = useAtomValue(
    openbot.adminToHost.permissionAtom(authority.environmentId, {
      hostId: authority.hostId,
      request: { operation: "vault.list", version },
    }),
  );
  const startup = useEffectEvent(() => {
    if (!c.state) void c.run({ operation: "vault.list", version });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the private host inventory with this mounted Vault version and its permission.
  useEffect(() => {
    if (!canLoad) return;
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) startup();
    });
    return () => {
      mounted = false;
    };
  }, [canLoad]);
  const effectiveScope = agentScope === undefined ? (selection?.agents ?? null) : agentScope;
  const refreshCode = async () => {
    if ((version !== "v3" && version !== "v4") || !selection) return;
    const generation = ++codeGeneration.current;
    const next = await c.getCode(version, selection.id);
    if (generation === codeGeneration.current) setCode(next);
  };
  const reloadCode = useEffectEvent(() => {
    void refreshCode();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch the next private verification code only while its exact login is visible.
  useEffect(() => {
    if (!codeOpen) return;
    const delay = code ? Math.max(250, code.expiresAt - Date.now() + 100) : 30_000;
    const timer = setTimeout(reloadCode, delay);
    return () => clearTimeout(timer);
  }, [codeOpen, code]);
  return (
    <View className="gap-3">
      {
        <Action
          {...authority}
          request={{ operation: "vault.list", version }}
          label={gt("Refresh vault")}
          disabled={c.busy}
          onAction={() => {
            choose(null);
            void run({ operation: "vault.list", version });
          }}
        />
      }
      {c.state && c.state.status !== "ready" && (
        <Text>
          <T>
            Vault <Var>{c.state.status}</Var>
          </T>
        </Text>
      )}
      {(c.error || localError) && <Text>{c.error || localError}</Text>}
      {c.notice && <Text>{c.notice}</Text>}
      {c.state?.items.map((item) => (
        <View key={item.id}>
          <Plain label={vaultLabel(item)} onClick={() => choose(item)} disabled={c.busy} />
        </View>
      ))}
      <Plain label={gt("New entry")} onClick={() => choose(null)} disabled={c.busy} />
      <Picker
        label={gt("Item kind")}
        value={kind}
        options={(version !== "v1"
          ? ["login", "card", "contact", "apiKey"]
          : ["login", "card", "contact"]
        ).map((id) => ({ id, name: id }))}
        disabled={c.busy || selection !== null}
        onChange={(value) => {
          if (value === "login" || value === "card" || value === "contact" || value === "apiKey") {
            clear();
            setKind(value);
            setFields({});
            setAgentScope(undefined);
            setAccessOpen(false);
          }
        }}
      />
      <View key={epoch}>
        {vaultFields[kind].map((key) => (
          <Field
            key={key}
            label={key}
            value={fields[key] ?? ""}
            onChange={(value) => setFields({ ...fields, [key]: value })}
            disabled={c.busy}
          />
        ))}
        {vaultPrivateFields[kind].map((key) => (
          <Private
            key={key}
            label={gt("Replacement {key}", { key })}
            onChange={(value) => {
              secrets.current[key] = value;
            }}
            disabled={c.busy}
          />
        ))}
      </View>
      {hasTwoStep && kind === "login" && (
        <SettingsSection title={gt("Two-step verification")}>
          <View className="gap-2 px-4 py-3">
            <Text className="text-foreground-muted">
              {keyChange === "update"
                ? gt("New key ready to save")
                : keyChange === "remove"
                  ? gt("Key will be removed when saved")
                  : selection?.kind === "login" && selection.hasTwoStep
                    ? gt("Verification key saved")
                    : gt("No verification key")}
            </Text>
            <Button
              label={gt("Set up verification key")}
              disabled={c.busy || c.state?.status !== "ready"}
              onPress={() => setSetup(true)}
            />
            {selection?.kind === "login" && selection.hasTwoStep && (
              <>
                <Button
                  label={gt("Show verification code")}
                  disabled={c.busy || codeOpen}
                  onPress={() => {
                    setCodeOpen(true);
                    void refreshCode();
                  }}
                />
                <Button
                  label={
                    keyChange === "remove"
                      ? gt("Keep verification key")
                      : gt("Remove verification key")
                  }
                  disabled={c.busy}
                  onPress={() => {
                    delete secrets.current.twoStepKey;
                    setKeyChange(keyChange === "remove" ? "keep" : "remove");
                  }}
                />
              </>
            )}
          </View>
        </SettingsSection>
      )}
      {codeOpen && (
        <BotVaultCodePanel live={code} busy={c.busy} onRefresh={() => void refreshCode()} />
      )}
      {setup && (
        <BotVaultTwoStepSetup
          onClose={() => setSetup(false)}
          onApply={(key) => {
            secrets.current.twoStepKey = key;
            setKeyChange("update");
            setSetup(false);
          }}
        />
      )}
      {version === "v4" && (
        <SettingsSection title={gt("Agent access")}>
          <View className="gap-2 px-4 py-3">
            <Text className="text-foreground-muted">
              {effectiveScope === null ? gt("Every agent") : `${effectiveScope.length} selected`}
            </Text>
            <Button
              label={accessOpen ? gt("Close agent access") : gt("Edit agent access")}
              disabled={c.busy}
              onPress={() => setAccessOpen(!accessOpen)}
            />
          </View>
          {accessOpen && (
            <>
              <SettingsSwitchRow
                icon="person.2"
                label={gt("Every agent")}
                value={effectiveScope === null}
                disabled={c.busy}
                onValueChange={(include) => setAgentScope(include ? null : [])}
              />
              {effectiveScope !== null &&
                workflowAgents(agentQuery.data).map((agent) => (
                  <SettingsSwitchRow
                    key={agent.id}
                    icon="person.crop.circle"
                    label={agent.name}
                    value={effectiveScope.includes(agent.id)}
                    disabled={c.busy}
                    onValueChange={(include) =>
                      setAgentScope(
                        include
                          ? [...new Set([...effectiveScope, agent.id])]
                          : effectiveScope.filter((id) => id !== agent.id),
                      )
                    }
                  />
                ))}
            </>
          )}
        </SettingsSection>
      )}
      {
        <Action
          {...authority}
          request={{
            operation: "vault.save",
            version,
            input: {
              kind: "login",
              id: selection?.id ?? null,
              website: "",
              username: "",
              notes: "",
              password: null,
            },
          }}
          label={gt("Save entry")}
          disabled={c.busy || c.state?.status !== "ready"}
          onAction={save}
        />
      }
      {selection && (
        <View>
          {vaultSecretFields(selection).map((field) => (
            <SecretField
              key={`${selection.id}:${field}`}
              {...authority}
              controller={c}
              request={
                field === "key"
                  ? {
                      operation: "vault.reveal",
                      version: version === "v1" ? "v2" : version,
                      id: selection.id,
                      field,
                    }
                  : { operation: "vault.reveal", version, id: selection.id, field }
              }
            />
          ))}
          <Plain
            label={confirmDelete ? gt("Cancel removal") : gt("Remove entry")}
            onClick={() => setConfirmDelete(!confirmDelete)}
            disabled={c.busy}
          />
          {confirmDelete && (
            <Action
              {...authority}
              request={{ operation: "vault.delete", version, id: selection.id }}
              label={gt("Confirm removal")}
              disabled={c.busy}
              onAction={() => {
                void run({ operation: "vault.delete", version, id: selection.id }).then((ok) => {
                  if (ok) choose(null);
                });
              }}
            />
          )}
        </View>
      )}
      {c.state?.status === "unreadable" && (
        <View>
          <Text>
            <T>Reset permanently removes unreadable vault data.</T>
          </Text>
          <Plain
            label={gt("Prepare unreadable vault reset")}
            onClick={() => setConfirmReset(!confirmReset)}
            disabled={c.busy}
          />
          {confirmReset && (
            <Action
              {...authority}
              request={{ operation: "vault.reset", version }}
              label={gt("Confirm vault reset")}
              disabled={c.busy}
              onAction={() => {
                void run({ operation: "vault.reset", version });
              }}
            />
          )}
        </View>
      )}
      <Action
        {...authority}
        request={{ operation: "vault.import", csv: "" }}
        label={gt("Import login CSV file")}
        disabled={c.busy || c.state?.status !== "ready"}
        onAction={() => {
          clear();
          void DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: false,
            type: ["text/csv", "text/comma-separated-values", "text/plain"],
          })
            .then(async (result) => {
              if (result.canceled || !c.isActive()) return;
              const asset = result.assets[0];
              if (!asset || (asset.size !== undefined && asset.size > 1048576)) {
                setLocalError(gt("Choose a CSV export smaller than 1 MiB."));
                return;
              }
              const csv = await new File(asset.uri).text();
              if (csv.length > 262144) {
                setLocalError(gt("CSV exports must be at most 262144 characters."));
                return;
              }
              await c.run({ operation: "vault.import", csv });
            })
            .catch(() => setLocalError(gt("Could not read the selected CSV export.")));
        }}
      />
      <Text>
        <T>
          Import adds login rows from a password-export CSV; other item kinds are skipped. Refresh
          after importing. Existing entries are not replaced.
        </T>
      </Text>
      <View key={`connectors:${epoch}`}>
        <Text>1Password: {c.onepassword?.state ?? gt("Not loaded")}</Text>
        {c.onepassword && (
          <Text>
            <T>
              <Var>{c.onepassword.vaultNames.join(", ")}</Var> ·{" "}
              <Var>{c.onepassword.loginCount ?? 0}</Var> logins ·<Var> </Var>
              <Var>{c.onepassword.error ?? ""}</Var>
            </T>
          </Text>
        )}
        <Private
          label={gt("1Password service account token")}
          onChange={(value) => {
            secrets.current.token = value;
          }}
          disabled={c.busy}
        />
        {
          <Action
            {...authority}
            request={{ operation: "vault.onepassword.connect", token: "" }}
            label={gt("Connect 1Password")}
            disabled={c.busy}
            onAction={() => {
              const token = secrets.current.token ?? "";
              clear();
              void c.run({ operation: "vault.onepassword.connect", token });
            }}
          />
        }
        {
          <Action
            {...authority}
            request={{ operation: "vault.onepassword.status" }}
            label={gt("Refresh 1Password / check access")}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.onepassword.status" });
            }}
          />
        }
        {
          <Action
            {...authority}
            request={{ operation: "vault.onepassword.disconnect" }}
            label={gt("Disconnect 1Password")}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.onepassword.disconnect" });
            }}
          />
        }
        <Text>
          <T>
            Bitwarden: <Var>{c.bitwarden?.state ?? gt("Not loaded")}</Var>{" "}
            <Var>{c.bitwarden?.serverUrl}</Var>
            <Var> </Var>
            <Var>{c.bitwarden?.error}</Var>
          </T>
        </Text>
        {["serverUrl", "clientId", "clientSecret", "masterPassword"].map((key) => (
          <Private
            key={key}
            label={gt("Bitwarden {key}", { key })}
            onChange={(value) => {
              secrets.current[key] = value;
            }}
            disabled={c.busy}
          />
        ))}
        {
          <Action
            {...authority}
            request={{
              operation: "vault.bitwarden.connect",
              serverUrl: "",
              clientId: "",
              clientSecret: "",
              masterPassword: "",
            }}
            label={gt("Connect Bitwarden")}
            disabled={c.busy}
            onAction={() => {
              const {
                serverUrl = "",
                clientId = "",
                clientSecret = "",
                masterPassword = "",
              } = secrets.current;
              clear();
              void c.run({
                operation: "vault.bitwarden.connect",
                serverUrl,
                clientId,
                clientSecret,
                masterPassword,
              });
            }}
          />
        }
        {
          <Action
            {...authority}
            request={{ operation: "vault.bitwarden.status" }}
            label={gt("Refresh Bitwarden status")}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.bitwarden.status" });
            }}
          />
        }
        {
          <Action
            {...authority}
            request={{ operation: "vault.bitwarden.disconnect" }}
            label={gt("Disconnect Bitwarden")}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.bitwarden.disconnect" });
            }}
          />
        }
      </View>
      <Text>
        <T>
          These released connectors have no separate test endpoint. Connect validates credentials;
          refresh checks host status. Bitwarden may remain connecting until a later refresh.
        </T>
      </Text>
    </View>
  );
}
type FieldProps = {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  disabled: boolean;
};
function Field({ label, value, onChange, disabled }: FieldProps) {
  return (
    <View>
      <Text>{label}</Text>
      <AppTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
function Private({ label, onChange, disabled }: FieldProps) {
  return (
    <View>
      <Text>{label}</Text>
      <AppTextInput
        accessibilityLabel={label}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="none"
        autoComplete="off"
        onChangeText={onChange}
        editable={!disabled}
      />
    </View>
  );
}
function Plain({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return <Button label={label} onPress={onClick} disabled={disabled} />;
}
function SecretField({
  controller: c,
  request,
  ...authority
}: Authority & {
  controller: VaultController;
  request: Extract<OpenbotVaultRequest, { operation: "vault.reveal" }>;
}) {
  const gt = useGT();
  const [value, setValue] = useState<string | null>(null);
  const active = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hide revealed native secrets when the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        active.current = false;
        setValue(null);
      } else active.current = true;
    });
    return () => subscription.remove();
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A reveal response may arrive after its selected item has unmounted.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const reveal = () => {
    setValue(null);
    void c.run(request, (secret) => {
      if (active.current) setValue(secret);
    });
  };
  const copy = () => {
    setValue(null);
    void c.run(request, async (secret) => {
      if (active.current) await Clipboard.setStringAsync(secret);
    });
  };
  return (
    <View>
      <Action
        {...authority}
        request={request}
        label={gt("Reveal {field}", { field: request.field })}
        disabled={c.busy}
        onAction={reveal}
      />
      <Action
        {...authority}
        request={request}
        label={gt("Copy {field}", { field: request.field })}
        disabled={c.busy}
        onAction={copy}
      />
      {value !== null && (
        <View>
          <AppTextInput
            accessibilityLabel={gt("Revealed secret")}
            value={value}
            editable={false}
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            textContentType="none"
            onBlur={() => setValue(null)}
          />
          <Plain label={gt("Hide secret")} onClick={() => setValue(null)} disabled={false} />
        </View>
      )}
    </View>
  );
}
