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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || !allowed}
      onClick={onAction}
    >
      {label}
    </Button>
  );
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
    <section className="space-y-3">
      <p>Vault and password managers</p>
      <p>
        Settings authority is required. Connecting a password manager also requires operate
        authority. Blank replacement secrets keep saved values.
      </p>
      <label>
        Vault API
        <select
          aria-label="Vault API"
          value={version}
          disabled={c.busy}
          onChange={(e) => {
            choose(null);
            c.clearState();
            setVersion(e.target.value === "v1" ? "v1" : "v2");
          }}
        >
          <option value="v2">v2 (includes API keys)</option>
          <option value="v1">v1</option>
        </select>
      </label>
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
      {c.state && <p>{c.state.status}</p>}
      {(c.error || localError) && <p role="alert">{c.error || localError}</p>}
      {c.notice && <p>{c.notice}</p>}
      {c.state?.items.map((item) => (
        <div key={item.id}>
          <Plain label={vaultLabel(item)} onClick={() => choose(item)} disabled={c.busy} />
        </div>
      ))}
      <Plain label="New entry" onClick={() => choose(null)} disabled={c.busy} />
      <label>
        Item kind
        <select
          aria-label="Item kind"
          value={kind}
          disabled={c.busy || selection !== null}
          onChange={(e) => {
            const value = e.target.value;
            if (
              value === "login" ||
              value === "card" ||
              value === "contact" ||
              value === "apiKey"
            ) {
              clear();
              setKind(value);
              setFields({});
            }
          }}
        >
          {(version === "v2"
            ? ["login", "card", "contact", "apiKey"]
            : ["login", "card", "contact"]
          ).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div key={epoch}>
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
      </div>
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
        <div className="space-y-2">
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
        </div>
      )}
      {c.state?.status === "unreadable" && (
        <div className="space-y-2">
          <p>Reset permanently removes unreadable vault data.</p>
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
        </div>
      )}
      <div key={`import:${epoch}`}>
        <Private
          label="CSV password export (up to 262144 characters)"
          onChange={(value) => {
            secrets.current.csv = value;
          }}
          disabled={c.busy}
        />
        {
          <Action
            {...authority}
            request={{ operation: "vault.import", csv: "" }}
            label={"Import logins"}
            disabled={c.busy || c.state?.status !== "ready"}
            onAction={() => {
              const csv = secrets.current.csv ?? "";
              clear();
              void c.run({ operation: "vault.import", csv });
            }}
          />
        }
      </div>
      <p>
        Import adds login rows from a password-export CSV; other item kinds are skipped. Refresh
        after importing. Existing entries are not replaced.
      </p>
      <div key={`connectors:${epoch}`}>
        <p>1Password: {c.onepassword?.state ?? "Not loaded"}</p>
        {c.onepassword && (
          <p>
            {c.onepassword.vaultNames.join(", ")} · {c.onepassword.loginCount ?? 0} logins ·{" "}
            {c.onepassword.error ?? ""}
          </p>
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
        <p>
          Bitwarden: {c.bitwarden?.state ?? "Not loaded"} {c.bitwarden?.serverUrl}{" "}
          {c.bitwarden?.error}
        </p>
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
      </div>
      <p>
        These released connectors have no separate test endpoint. Connect validates credentials;
        refresh checks host status. Bitwarden may remain connecting until a later refresh.
      </p>
    </section>
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
    <label>
      {label}
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
function Private({ label, onChange, disabled }: FieldProps) {
  return (
    <label>
      {label}
      <Input
        aria-label={label}
        type="password"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
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
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
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
  const [copyError, setCopyError] = useState<string | null>(null);
  const active = useRef(true);
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
    setCopyError(null);
    const content = new Promise<Blob>((resolve, reject) => {
      void c
        .run(request, (secret) => {
          if (active.current) resolve(new Blob([secret], { type: "text/plain" }));
          else reject(new Error("Selection changed"));
        })
        .then((ok) => {
          if (!ok) reject(new Error("Reveal failed"));
        });
    });
    void navigator.clipboard
      .write([new ClipboardItem({ "text/plain": content })])
      .catch(() => setCopyError("Could not copy the secret. Reveal it and copy manually."));
  };
  return (
    <div className="space-y-2">
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
      {copyError && <p role="alert">{copyError}</p>}
      {value !== null && (
        <div className="space-y-2">
          <Input
            aria-label="Revealed secret"
            value={value}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onBlur={() => setValue(null)}
          />
          <Plain label="Hide secret" onClick={() => setValue(null)} disabled={false} />
        </div>
      )}
    </div>
  );
}
