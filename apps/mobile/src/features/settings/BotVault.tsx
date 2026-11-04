import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { OpenbotVaultItem, OpenbotVaultRequest } from "@t3tools/contracts";
import {
  vaultFields,
  vaultPrivateFields,
  vaultSecretFields,
  vaultDraft,
  vaultSaveRequest,
  vaultLabel,
  type VaultKind,
} from "@t3tools/client-runtime/openbot/presentation";
import { useBotVault, type VaultController } from "./useBotVault";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppState, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Clipboard from "expo-clipboard";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Picker } from "./BotConnectionControls";
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
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const controller = useBotVault(async (request) => {
    const result = await admin({ environmentId, input: { hostId, request } });
    return result._tag === "Failure"
      ? { ok: false, error: "Vault request failed." }
      : { ok: true, value: result.value };
  });
  return (
    <VaultPanel
      key={`${environmentId}:${hostId}`}
      controller={controller}
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
function VaultPanel({ controller: c, ...authority }: Authority & { controller: VaultController }) {
  const [version, setVersion] = useState<"v1" | "v2">("v2");
  const [selection, setSelection] = useState<OpenbotVaultItem | null>(null);
  const [kind, setKind] = useState<VaultKind>("login");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [epoch, setEpoch] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const secrets = useRef<Record<string, string>>({});
  const clear = () => {
    secrets.current = {};
    setEpoch((v) => v + 1);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clear private native input buffers before the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        secrets.current = {};
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
    setConfirmDelete(false);
  };
  const run = (request: OpenbotVaultRequest) => {
    clear();
    return c.run(request);
  };
  const save = () => {
    const request = vaultSaveRequest(kind, selection?.id ?? null, fields, secrets.current, version);
    clear();
    if (request === null) {
      setLocalError("Check the item fields and try again.");
      return;
    }
    setLocalError(null);
    void c.run(request).then((ok) => {
      if (ok) choose(null);
    });
  };
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <View>
      <Text>Vault and password managers</Text>
      <Text>
        Settings authority is required. Connecting a password manager also requires operate
        authority. Blank replacement secrets keep saved values.
      </Text>
      <Picker
        label="Vault API"
        value={version}
        options={[
          { id: "v2", name: "v2 (includes API keys)" },
          { id: "v1", name: "v1" },
        ]}
        disabled={c.busy}
        onChange={(value) => {
          choose(null);
          c.clearState();
          setVersion(value === "v1" ? "v1" : "v2");
        }}
      />
      {
        <Action
          {...authority}
          request={{ operation: "vault.list", version }}
          label={"Refresh vault"}
          disabled={c.busy}
          onAction={() => {
            choose(null);
            void run({ operation: "vault.list", version });
          }}
        />
      }
      {c.state && <Text>{c.state.status}</Text>}
      {(c.error || localError) && <Text>{c.error || localError}</Text>}
      {c.notice && <Text>{c.notice}</Text>}
      {c.state?.items.map((item) => (
        <View key={item.id}>
          <Plain label={vaultLabel(item)} onClick={() => choose(item)} disabled={c.busy} />
        </View>
      ))}
      <Plain label="New entry" onClick={() => choose(null)} disabled={c.busy} />
      <Picker
        label="Item kind"
        value={kind}
        options={(version === "v2"
          ? ["login", "card", "contact", "apiKey"]
          : ["login", "card", "contact"]
        ).map((id) => ({ id, name: id }))}
        disabled={c.busy || selection !== null}
        onChange={(value) => {
          if (value === "login" || value === "card" || value === "contact" || value === "apiKey") {
            clear();
            setKind(value);
            setFields({});
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
            label={`Replacement ${key}`}
            onChange={(value) => {
              secrets.current[key] = value;
            }}
            disabled={c.busy}
          />
        ))}
      </View>
      {
        <Action
          {...authority}
          request={{
            operation: "vault.save",
            version: "v2",
            input: {
              kind: "login",
              id: selection?.id ?? null,
              website: "",
              username: "",
              notes: "",
              password: null,
            },
          }}
          label={"Save entry"}
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
                  ? { operation: "vault.reveal", version: "v2", id: selection.id, field }
                  : { operation: "vault.reveal", version, id: selection.id, field }
              }
            />
          ))}
          <Plain
            label={confirmDelete ? "Cancel removal" : "Remove entry"}
            onClick={() => setConfirmDelete(!confirmDelete)}
            disabled={c.busy}
          />
          {confirmDelete && (
            <Action
              {...authority}
              request={{ operation: "vault.delete", version, id: selection.id }}
              label={"Confirm removal"}
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
          <Text>Reset permanently removes unreadable vault data.</Text>
          <Plain
            label="Prepare unreadable vault reset"
            onClick={() => setConfirmReset(!confirmReset)}
            disabled={c.busy}
          />
          {confirmReset && (
            <Action
              {...authority}
              request={{ operation: "vault.reset", version }}
              label={"Confirm vault reset"}
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
        label="Import login CSV file"
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
                setLocalError("Choose a CSV export smaller than 1 MiB.");
                return;
              }
              const csv = await new File(asset.uri).text();
              if (csv.length > 262144) {
                setLocalError("CSV exports must be at most 262144 characters.");
                return;
              }
              await c.run({ operation: "vault.import", csv });
            })
            .catch(() => setLocalError("Could not read the selected CSV export."));
        }}
      />
      <Text>
        Import adds login rows from a password-export CSV; other item kinds are skipped. Refresh
        after importing. Existing entries are not replaced.
      </Text>
      <View key={`connectors:${epoch}`}>
        <Text>1Password: {c.onepassword?.state ?? "Not loaded"}</Text>
        {c.onepassword && (
          <Text>
            {c.onepassword.vaultNames.join(", ")} · {c.onepassword.loginCount ?? 0} logins ·{" "}
            {c.onepassword.error ?? ""}
          </Text>
        )}
        <Private
          label="1Password service account token"
          onChange={(value) => {
            secrets.current.token = value;
          }}
          disabled={c.busy}
        />
        {
          <Action
            {...authority}
            request={{ operation: "vault.onepassword.connect", token: "" }}
            label={"Connect 1Password"}
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
            label={"Refresh 1Password / check access"}
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
            label={"Disconnect 1Password"}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.onepassword.disconnect" });
            }}
          />
        }
        <Text>
          Bitwarden: {c.bitwarden?.state ?? "Not loaded"} {c.bitwarden?.serverUrl}{" "}
          {c.bitwarden?.error}
        </Text>
        {["serverUrl", "clientId", "clientSecret", "masterPassword"].map((key) => (
          <Private
            key={key}
            label={`Bitwarden ${key}`}
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
            label={"Connect Bitwarden"}
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
            label={"Refresh Bitwarden status"}
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
            label={"Disconnect Bitwarden"}
            disabled={c.busy}
            onAction={() => {
              void run({ operation: "vault.bitwarden.disconnect" });
            }}
          />
        }
      </View>
      <Text>
        These released connectors have no separate test endpoint. Connect validates credentials;
        refresh checks host status. Bitwarden may remain connecting until a later refresh.
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
        label={`Reveal ${request.field}`}
        disabled={c.busy}
        onAction={reveal}
      />
      <Action
        {...authority}
        request={request}
        label={`Copy ${request.field}`}
        disabled={c.busy}
        onAction={copy}
      />
      {value !== null && (
        <View>
          <AppTextInput
            accessibilityLabel="Revealed secret"
            value={value}
            editable={false}
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            textContentType="none"
            onBlur={() => setValue(null)}
          />
          <Plain label="Hide secret" onClick={() => setValue(null)} disabled={false} />
        </View>
      )}
    </View>
  );
}
