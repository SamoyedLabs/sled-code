/* oxlint-disable shadcn/no-unknown-classes -- Source OnePasswordConnectorPanel/BitwardenConnectorPanel remote branches and VaultParts. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import * as Option from "effect/Option";
import type { EnvironmentId, OpenbotVaultRequest } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Lock, ShieldCheck } from "lucide-react";
import { openbot } from "../../../../state/openbot";
import { readPreparedConnection, usePreparedConnection } from "../../../../state/session";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useBotVault } from "../../../settings/useBotVault";
import { DetailHeader } from "../marketplace/MarketplaceParts";
import { SettingsSection, SettingsRow, SourceButton } from "../settings/SettingsParts";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { VaultField } from "./VaultItemDialog";
import { OnePasswordMark } from "./OnePasswordMark";
import { t } from "./connector-text";
import "./VaultConnectors.css";
export function VaultConnectorEnvironment(props: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  connector: "onepassword" | "bitwarden";
}) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <ConnectorHost
      key={`${props.environmentId}:${props.hostId}:${props.connector}:${session.epoch}`}
      {...props}
    />
  );
}
function ConnectorHost({
  environmentId,
  hostId,
  hostName,
  connector,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  connector: "onepassword" | "bitwarden";
}) {
  const registry = useContext(RegistryContext),
    admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = readPreparedConnection(environmentId),
    active = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Do not accept private connection replies after the host pane closes.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const execute = async (request: OpenbotVaultRequest) => {
    if (!connection || !active.current || readPreparedConnection(environmentId) !== connection)
      throw new Error("Reconnect the original host session.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You don’t have permission to manage this connection.");
    const result = await admin({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (!active.current || readPreparedConnection(environmentId) !== connection)
      throw new Error("The original host session changed.");
    return result.value;
  };
  const c = useBotVault(async (request) => {
    try {
      return { ok: true, value: await execute(request) };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : "The connection request failed.",
      };
    }
  });
  const statusRequest = {
    operation:
      connector === "onepassword"
        ? ("vault.onepassword.status" as const)
        : ("vault.bitwarden.status" as const),
  };
  const canRead = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, { hostId, request: statusRequest }),
  );
  const [readError, setReadError] = useState<string | null>(null),
    [confirming, setConfirming] = useState(false),
    [token, setToken] = useState(""),
    [serverUrl, setServerUrl] = useState("https://vault.bitwarden.com"),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [masterPassword, setMasterPassword] = useState("");
  const load = async () => {
    const ok = await c.run(statusRequest);
    if (active.current) setReadError(ok ? null : "Could not read the connection status.");
  };
  const loadEvent = useEffectEvent(load);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read only the permitted connector status when the host grants access.
  useEffect(() => {
    if (canRead) void loadEvent();
  }, [canRead]);
  const status = connector === "onepassword" ? c.onepassword : c.bitwarden;
  const connected = status?.state === "connected",
    connecting = status?.state === "connecting";
  const prefix = connector === "onepassword" ? "connector.onePassword" : "connector.bitwarden";
  const unknown = !canRead || Boolean(readError) || !status;
  const name = t(`${prefix}.title`),
    description = t(`${prefix}.descriptionHost`, { host: hostName });
  const disconnect = async () => {
    const ok = await c.run({
      operation:
        connector === "onepassword" ? "vault.onepassword.disconnect" : "vault.bitwarden.disconnect",
    });
    if (ok) setConfirming(false);
  };
  const notes = (
    <>
      <p className="ui-text integration-card-note" data-variant="caption" data-tone="muted">
        {t("connector.bitwarden.scopeHost", { host: hostName })}
      </p>
      <p className="ui-text integration-card-note" data-variant="caption" data-tone="muted">
        {t("connector.bitwarden.sessionHost", { host: hostName })}
      </p>
    </>
  );
  return (
    <div
      className={`integration-page ${connector === "onepassword" ? "onepassword-connector" : "bitwarden-connector"}`}
    >
      <DetailHeader
        logo={connector === "onepassword" ? <OnePasswordMark /> : <Lock />}
        name={name}
        subtitle={description}
        status={
          unknown ? "attention" : connecting ? "connecting" : connected ? "connected" : "idle"
        }
        statusLabel={
          unknown
            ? t("connector.statusUnknown")
            : connecting
              ? t(
                  connector === "onepassword"
                    ? "connector.onePassword.statusConnecting"
                    : "connector.bitwarden.connecting",
                )
              : connected
                ? t(
                    connector === "onepassword"
                      ? "connector.onePassword.statusConnected"
                      : "connector.bitwarden.connected",
                  )
                : "Not connected"
        }
      />
      {unknown ? (
        <div className="ui-alert" data-tone="warning" role="alert">
          <span className="ui-alert-icon">
            <ShieldCheck />
          </span>
          <div className="ui-alert-content">
            <div className="ui-alert-title">{t("connector.readFailed")}</div>
            <p className="ui-alert-description">
              {!canRead
                ? "You don’t have permission to view this connection."
                : (readError ?? "Loading connection…")}
            </p>
          </div>
          <div className="ui-alert-actions">
            <SourceButton disabled={!canRead || c.busy} onClick={() => void load()}>
              {t("common.retry")}
            </SourceButton>
          </div>
        </div>
      ) : (
        <>
          {(status.error || c.error) && (
            <p className="ui-text" data-tone="danger" role="alert">
              {status.error || c.error}
            </p>
          )}
          {connector === "onepassword" ? (
            !connected ? (
              <SettingsSection
                title={t("connector.onePassword.tokenLabel")}
                description={t("connector.onePassword.howItWorksHost", { host: hostName })}
              >
                <div className="ui-item-group settings-modal-card">
                  <div className="integration-card-body">
                    <form
                      className="vault-secret-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = token.trim();
                        if (!value || c.busy || connecting) return;
                        setToken("");
                        void c.run({ operation: "vault.onepassword.connect", token: value });
                      }}
                    >
                      <VaultField label={t("connector.onePassword.tokenLabel")}>
                        <input
                          className="ui-input"
                          data-size="sm"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t("connector.onePassword.tokenPlaceholder")}
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                        />
                      </VaultField>
                      <div className="vault-secret-actions">
                        <SourceButton
                          variant="default"
                          type="submit"
                          disabled={!token.trim() || c.busy || connecting}
                        >
                          {t("connector.onePassword.connectWithToken")}
                        </SourceButton>
                      </div>
                    </form>
                  </div>
                </div>
              </SettingsSection>
            ) : (
              <SettingsSection
                title={t("connector.onePassword.vaultTitle")}
                description={t("connector.onePassword.vaultDescription")}
              >
                <div className="ui-item-group settings-modal-card">
                  {c.onepassword?.vaultNames.map((vault) => (
                    <SettingsRow
                      key={vault}
                      title={vault}
                      description={
                        c.onepassword?.vaultNames.length === 1
                          ? c.onepassword.loginCount === null
                            ? t("connector.onePassword.loginsLoading")
                            : t("connector.onePassword.loginCount", {
                                count: c.onepassword.loginCount,
                              })
                          : undefined
                      }
                    />
                  ))}
                  {c.onepassword && c.onepassword.vaultNames.length !== 1 && (
                    <p
                      className="ui-text integration-card-note"
                      data-variant="caption"
                      data-tone="muted"
                    >
                      {c.onepassword.loginCount === null
                        ? t("connector.onePassword.loginsLoading")
                        : t("connector.onePassword.loginCount", {
                            count: c.onepassword.loginCount,
                          })}
                    </p>
                  )}
                </div>
              </SettingsSection>
            )
          ) : !connected ? (
            <SettingsSection
              title={t("connector.bitwarden.connect")}
              description={t("connector.bitwarden.setupHost", { host: hostName })}
            >
              <div className="ui-item-group settings-modal-card">
                <div className="integration-card-body">
                  <form
                    className="bitwarden-connector-host-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        c.busy ||
                        connecting ||
                        !serverUrl.trim() ||
                        !clientId.trim() ||
                        !clientSecret.trim() ||
                        !masterPassword
                      )
                        return;
                      const input = {
                        serverUrl: serverUrl.trim(),
                        clientId: clientId.trim(),
                        clientSecret: clientSecret.trim(),
                        masterPassword,
                      };
                      setClientSecret("");
                      setMasterPassword("");
                      void c.run({ operation: "vault.bitwarden.connect", ...input });
                    }}
                  >
                    <VaultField label={t("connector.bitwarden.serverUrl")}>
                      <input
                        className="ui-input"
                        data-size="sm"
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        value={serverUrl}
                        onChange={(event) => setServerUrl(event.target.value)}
                      />
                    </VaultField>
                    <VaultField label={t("connector.bitwarden.clientId")}>
                      <input
                        className="ui-input"
                        data-size="sm"
                        autoComplete="off"
                        spellCheck={false}
                        value={clientId}
                        onChange={(event) => setClientId(event.target.value)}
                      />
                    </VaultField>
                    <VaultField label={t("connector.bitwarden.clientSecret")}>
                      <input
                        className="ui-input"
                        data-size="sm"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={clientSecret}
                        onChange={(event) => setClientSecret(event.target.value)}
                      />
                    </VaultField>
                    <VaultField label={t("connector.bitwarden.masterPassword")}>
                      <input
                        className="ui-input"
                        data-size="sm"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={masterPassword}
                        onChange={(event) => setMasterPassword(event.target.value)}
                      />
                    </VaultField>
                    <div className="bitwarden-connector-actions">
                      <SourceButton
                        type="submit"
                        variant="default"
                        disabled={
                          c.busy ||
                          connecting ||
                          !serverUrl.trim() ||
                          !clientId.trim() ||
                          !clientSecret.trim() ||
                          !masterPassword
                        }
                      >
                        {t("connector.bitwarden.connect")}
                      </SourceButton>
                      {connecting && (
                        <SourceButton variant="ghost" onClick={() => void disconnect()}>
                          {t("common.cancel")}
                        </SourceButton>
                      )}
                    </div>
                  </form>
                </div>
                {notes}
              </div>
            </SettingsSection>
          ) : (
            <SettingsSection
              title={t("connector.bitwarden.folderTitle")}
              description={t("connector.bitwarden.folderDescription")}
            >
              <div className="ui-item-group settings-modal-card">
                <SettingsRow
                  title={t("connector.bitwarden.folderName")}
                  description={t("connector.bitwarden.folderKind")}
                />
                {c.bitwarden?.serverUrl && (
                  <SettingsRow
                    title={t("connector.bitwarden.serverUrl")}
                    description={c.bitwarden.serverUrl}
                  />
                )}
                {notes}
              </div>
            </SettingsSection>
          )}
          {connected && (
            <SettingsSection title={t("connector.dangerZone")}>
              <div className="ui-item-group settings-modal-card">
                <SettingsRow
                  title={t(
                    connector === "onepassword"
                      ? "connector.onePassword.disconnectTitle"
                      : "connector.bitwarden.disconnect",
                  )}
                  description={t(`${prefix}.disconnectSummaryHost`, { host: hostName })}
                >
                  <SourceButton
                    variant="destructive-ghost"
                    disabled={c.busy}
                    onClick={() => setConfirming(true)}
                  >
                    {t(
                      connector === "onepassword"
                        ? "connector.onePassword.disconnect"
                        : "connector.bitwarden.disconnectAction",
                    )}
                  </SourceButton>
                </SettingsRow>
              </div>
            </SettingsSection>
          )}
        </>
      )}
      <SourceConfirmDialog
        open={confirming}
        title={t(
          connector === "onepassword"
            ? "connector.onePassword.disconnectTitle"
            : "connector.bitwarden.disconnect",
        )}
        description={t(`${prefix}.disconnectSummaryHost`, { host: hostName })}
        confirmLabel={t(
          connector === "onepassword"
            ? "connector.onePassword.disconnect"
            : "connector.bitwarden.disconnectAction",
        )}
        pending={c.busy}
        error={c.error}
        onCancel={() => setConfirming(false)}
        onConfirm={disconnect}
      />
    </div>
  );
}
