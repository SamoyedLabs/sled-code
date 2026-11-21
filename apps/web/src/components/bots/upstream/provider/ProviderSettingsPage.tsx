import { SourceProgress } from "./SourceProgress";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned ProviderSettingsPage.tsx DOM and source styles translated to React. */
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  Gauge,
  Link,
  Smartphone,
  ChevronRight,
  Ellipsis,
  Pencil,
  Trash2,
  LogOut,
  LogIn,
  UserRoundPlus,
  KeyRound,
  SlidersHorizontal,
} from "lucide-react";
import {
  SettingsSection,
  SettingsSearch,
  SettingsCard,
  SettingsRow,
  SourceButton,
} from "../settings/SettingsParts";
import { DetailHeader } from "../marketplace/MarketplaceParts";
import { MenuPopup } from "../OpenbotMenu";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { ProviderLogo } from "./ProviderLogo";
import { AccountUsageWindowList } from "./AccountUsageDetails";
import type { AccountUsageProviderRow } from "./account-usage-view";
import { providerAccountName, isApiKeyAccount } from "./provider-accounts";
import { isAgentProvider } from "./identity";
import { currentText } from "./text";
import {
  providerSettingsLabel,
  providerSettingsSummary,
  providerSettingsRows,
  providerUpdateAvailable,
  waitingAccounts,
  type ProviderSettingsOption,
  type ProviderSettingsAccount,
} from "./provider-settings-model";
import "./ProviderSettingsPage.css";
import "./AccountUsage.css";
import { useGT } from "gt-react";
const { t, format } = currentText();
const names = (values: readonly string[]) =>
  new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(values);
export interface ProviderSettingsActions {
  usageResets?: (() => Promise<readonly { accountId: string; available: number }[]>) | undefined;
  resetUsage?:
    | ((accountId: string) => Promise<"reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed">)
    | undefined;
  accountConnect?: boolean;
  alternative?: { kind: "address" | "code"; run: () => void } | undefined;
  connect?: ((id: string, accountId?: string | null) => void) | undefined;
  cancelConnect?: ((id: string) => Promise<void>) | undefined;
  rename?: ((id: string, accountId: string, label: string | null) => Promise<void>) | undefined;
  remove?: ((id: string, accountId: string) => Promise<void>) | undefined;
  signOut?: ((id: string) => Promise<void>) | undefined;
  apiKey?: ((id: string) => void) | undefined;
  download?: ((id: string) => Promise<void>) | undefined;
  cancelDownload?: ((id: string) => Promise<void>) | undefined;
  update?: ((id: string) => Promise<void>) | undefined;
}
export interface ProviderSettingsPageProps {
  options: readonly ProviderSettingsOption[];
  usage: readonly AccountUsageProviderRow[];
  actions: (id: string) => ProviderSettingsActions;
  disabled?: boolean;
  error?: string | null;
  onDetailChange?: ((detail: { title: string; back: () => void } | null) => void) | undefined;
  modelVisibility?: (id: string) => ReactNode;
  promptCache?: ReactNode;
  custom?: { summary: string; detail: ReactNode; connected?: boolean } | undefined;
  footer?: ReactNode;
}
export function ProviderSettingsPage(props: ProviderSettingsPageProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const option = props.options.find((o) => o.id === selected);
  const custom = selected === "custom" && props.custom;
  const onDetailChange = props.onDetailChange;
  const title = option?.name ?? (custom ? t("provider.custom.name") : null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Publish the nested source page title to the enclosing settings navigation and clear it on unmount.
  useEffect(() => {
    onDetailChange?.(title ? { title, back: () => setSelected(null) } : null);
    return () => onDetailChange?.(null);
  }, [title, onDetailChange]);
  return (
    <div className="provider-settings-stack">
      {props.error && (
        <p className="provider-settings-error" role="alert">
          {props.error}
        </p>
      )}
      {option ? (
        <ProviderPage key={option.id} {...props} option={option} />
      ) : custom ? (
        custom.detail
      ) : (
        <ProviderList {...props} onOpen={setSelected} />
      )}
    </div>
  );
}
function ProviderList(props: ProviderSettingsPageProps & { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const rows = providerSettingsRows(props.options, query);
  const custom =
    props.custom &&
    (!query.trim() ||
      `${t("provider.custom.name")} ${props.custom.summary}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()));
  return (
    <>
      <SettingsSection
        title={t("provider.settings.connected")}
        actions={
          <SettingsSearch label={t("provider.settings.search")} value={query} onChange={setQuery} />
        }
      >
        <SettingsCard>
          {rows.connected.length === 0 && !(custom && props.custom?.connected) && (
            <div className="ui-item server-settings-empty-row">
              <div className="ui-item-content">
                <div className="ui-item-description">
                  {t(
                    query.trim()
                      ? rows.other.length
                        ? "provider.settings.noConnectedMatch"
                        : "provider.settings.noMatch"
                      : "provider.settings.noneConnected",
                    { query: query.trim() },
                  )}
                </div>
              </div>
            </div>
          )}
          {rows.connected.map((o) => (
            <ProviderNav key={o.id} option={o} onOpen={() => props.onOpen(o.id)} />
          ))}
          {custom && props.custom?.connected && (
            <NavRow
              name={t("provider.custom.name")}
              summary={props.custom.summary || t("provider.custom.description")}
              logo={<SlidersHorizontal className="provider-picker-custom-mark" />}
              onOpen={() => props.onOpen("custom")}
            />
          )}
        </SettingsCard>
      </SettingsSection>
      {(rows.other.length > 0 || (custom && !props.custom?.connected)) && (
        <SettingsSection title={t("provider.settings.other")}>
          <SettingsCard>
            {rows.other.map((o) => (
              <ProviderNav key={o.id} option={o} onOpen={() => props.onOpen(o.id)} />
            ))}
            {custom && !props.custom?.connected && (
              <NavRow
                name={t("provider.custom.name")}
                summary={props.custom?.summary || t("provider.custom.description")}
                logo={<SlidersHorizontal className="provider-picker-custom-mark" />}
                onOpen={() => props.onOpen("custom")}
              />
            )}
          </SettingsCard>
        </SettingsSection>
      )}
      {props.footer}
    </>
  );
}
function NavRow(props: {
  name: string;
  summary: string;
  logo: ReactNode;
  end?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <div className="ui-item settings-modal-row integrations-hub-row" data-size="default">
      <SourceButton
        variant="ghost"
        className="integrations-hub-hitarea"
        aria-label={t("provider.settings.open", { name: props.name })}
        data-cuelume-tap="navigate"
        onClick={props.onOpen}
      />
      <div className="ui-item-media">{props.logo}</div>
      <div className="ui-item-content">
        <div className="ui-item-title">{props.name}</div>
        <div className="ui-item-description">{props.summary}</div>
      </div>
      <div className="ui-item-actions integrations-hub-actions">
        {props.end}
        <ChevronRight className="integrations-hub-chevron" aria-hidden="true" />
      </div>
    </div>
  );
}
function ProviderNav({ option, onOpen }: { option: ProviderSettingsOption; onOpen: () => void }) {
  const runtime = option.runtimeStatus;
  const busy =
    !option.off &&
    (option.connectionState === "connecting" ||
      runtime?.phase === "downloading" ||
      runtime?.phase === "finishing");
  const warning = waitingAccounts(option)
    ? t("provider.settings.badge.signIn")
    : runtime?.phase === "download-error"
      ? t(runtime.version ? "provider.status.updateFailed" : "provider.status.setupFailed")
      : option.lastError
        ? t("provider.settings.badge.error")
        : option.state === "outdated"
          ? t("provider.status.updateRequired")
          : runtime && providerUpdateAvailable(runtime)
            ? t("provider.status.updateAvailable")
            : null;
  return (
    <NavRow
      name={option.name}
      summary={providerSettingsSummary(option)}
      logo={<ProviderMark option={option} />}
      end={
        busy ? (
          <span className="ui-spinner" role="status" aria-label={providerSettingsLabel(option)} />
        ) : !option.off && warning ? (
          <span
            className={`z-badge z-badge-variant-${runtime?.phase === "download-error" ? "destructive" : "warning"}-light`}
          >
            {warning}
          </span>
        ) : null
      }
      onOpen={onOpen}
    />
  );
}
function ProviderMark({ option }: { option: ProviderSettingsOption }) {
  return isAgentProvider(option.id) ? (
    <ProviderLogo
      provider={option.id}
      className={`provider-picker-logo ${option.off ? "provider-settings-logo-off" : ""}`}
    />
  ) : (
    <span className="provider-picker-custom-mark">{option.name.slice(0, 1)}</span>
  );
}
function ProviderPage(props: ProviderSettingsPageProps & { option: ProviderSettingsOption }) {
  const o = props.option,
    a = props.actions(o.id),
    runtime = o.runtimeStatus;
  const [error, setError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("provider.account.actionFailed", { name: o.name }),
      );
    }
  };
  const connecting =
    o.connectionState === "connecting" ||
    runtime?.phase === "downloading" ||
    runtime?.phase === "finishing";
  const status = o.off
    ? "unavailable"
    : connecting && o.state !== "available"
      ? "connecting"
      : runtime?.phase === "download-error" ||
          o.state === "error" ||
          o.state === "outdated" ||
          waitingAccounts(o) ||
          o.lastError
        ? "attention"
        : o.state === "available"
          ? "connected"
          : "idle";
  const label =
    waitingAccounts(o) && o.state === "available"
      ? t("provider.settings.status.needsSignIn")
      : providerSettingsLabel(o);
  const used = o.usedBy;
  const subtitle = used
    ? used.length
      ? t("provider.settings.usedByCount", { count: used.length })
      : t("provider.settings.unused")
    : undefined;
  const showAccounts =
    Boolean(a.rename) && (o.accounts?.length ?? 0) > 0 && o.state === "available" && !o.off;
  const keyShown = Boolean(a.apiKey);
  const runtimeAction =
    runtime?.phase === "downloading"
      ? "cancel"
      : runtime?.phase === "not-downloaded"
        ? "download"
        : runtime?.phase === "download-error"
          ? "retry"
          : null;
  const version = runtime?.version ? `v${runtime.version.replace(/^v/, "")}` : null;
  const versionLine =
    runtime?.phase === "ready"
      ? version &&
        (o.cliSource
          ? t(
              o.cliSource === "system"
                ? "provider.settings.versionInstalledByUser"
                : "provider.settings.versionDownloaded",
              { version },
            )
          : version)
      : (runtime?.message ?? providerSettingsLabel(o));
  return (
    <>
      <DetailHeader
        logo={<ProviderMark option={o} />}
        name={o.name}
        status={status}
        statusLabel={label}
        subtitle={subtitle ?? ""}
      />
      {!o.off && (
        <>
          {showAccounts ? (
            <Accounts option={o} actions={a} usage={props.usage} disabled={props.disabled} />
          ) : (
            <SettingsSection title={t("provider.settings.signIn")}>
              <SettingsCard>
                <SettingsRow
                  title={o.email ?? providerSettingsLabel(o)}
                  description={
                    <>
                      {o.checkError && <div>{o.checkError}</div>}
                      {o.message && <div>{o.message}</div>}
                      {o.id === "antigravity" && !a.connect && o.state !== "available" && (
                        <div>{t("provider.gemini.hostSignIn")}</div>
                      )}
                    </>
                  }
                >
                  {a.connect && (
                    <SourceButton
                      variant={o.state === "available" ? "outline" : "default"}
                      disabled={
                        props.disabled ||
                        runtime?.phase === "downloading" ||
                        runtime?.phase === "finishing"
                      }
                      onClick={() => a.connect?.(o.id)}
                    >
                      {t(
                        o.state === "available"
                          ? "provider.action.reconnect"
                          : "provider.action.connect",
                      )}
                    </SourceButton>
                  )}
                  {(a.alternative || (a.signOut && o.state === "available")) && (
                    <Menu.Root>
                      <Menu.Trigger
                        className="ui-button ui-button-variant-ghost ui-button-size-icon-sm ui-icon-button"
                        aria-label={t("provider.aria.moreActions", { name: o.name })}
                      >
                        <Ellipsis />
                      </Menu.Trigger>
                      <MenuPopup align="end">
                        <AlternativeItem actions={a} />
                        {a.signOut && o.state === "available" && (
                          <Menu.Item
                            className="ui-action-menu-item"
                            onClick={() => setDisconnect(true)}
                          >
                            <LogOut />
                            {t("provider.account.disconnect")}
                          </Menu.Item>
                        )}
                      </MenuPopup>
                    </Menu.Root>
                  )}
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          )}
          {keyShown && (
            <SettingsSection title={t("provider.settings.apiKey")}>
              <SettingsCard>
                <SettingsRow
                  title={t(
                    o.keyStatus === "saved"
                      ? "provider.settings.keySaved"
                      : o.keyStatus
                        ? "provider.settings.noKey"
                        : "provider.action.apiKey",
                  )}
                  description={t(
                    o.id === "opencode"
                      ? "provider.settings.keyOptional"
                      : o.id === "claude" && o.keyStatus === "saved"
                        ? "provider.settings.claudeKeyInUse"
                        : "provider.settings.keyAlternative",
                    { name: o.name },
                  )}
                >
                  <SourceButton
                    aria-label={t("provider.aria.apiKey", { name: o.name })}
                    disabled={props.disabled}
                    onClick={() => a.apiKey?.(o.id)}
                  >
                    {t(
                      o.keyStatus === "saved"
                        ? "provider.settings.changeKey"
                        : "provider.settings.addKey",
                    )}
                  </SourceButton>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          )}
          {(runtime || o.lastError) && (
            <SettingsSection title={t("provider.settings.runtime")}>
              <SettingsCard>
                {runtime && (
                  <SettingsRow
                    title={t("provider.settings.version")}
                    description={
                      <>
                        {versionLine}
                        {runtime.phase === "downloading" && (
                          <SourceProgress
                            className="provider-settings-progress"
                            value={runtime.progress ?? undefined}
                            label={t("provider.settings.downloadLabel", { name: o.name })}
                          />
                        )}
                      </>
                    }
                  >
                    {runtimeAction === "cancel"
                      ? a.cancelDownload && (
                          <SourceButton
                            disabled={props.disabled}
                            onClick={() => void run(() => a.cancelDownload!(o.id))}
                          >
                            {t("common.cancel")}
                          </SourceButton>
                        )
                      : runtimeAction
                        ? a.download && (
                            <SourceButton
                              variant={runtimeAction === "download" ? "default" : "outline"}
                              disabled={props.disabled}
                              onClick={() => void run(() => a.download!(o.id))}
                            >
                              {t(runtimeAction === "retry" ? "common.retry" : "common.download")}
                            </SourceButton>
                          )
                        : a.update && (
                            <SourceButton
                              disabled={props.disabled || connecting}
                              onClick={() => void run(() => a.update!(o.id))}
                            >
                              {t(
                                providerUpdateAvailable(runtime)
                                  ? "provider.settings.update"
                                  : "provider.action.checkForUpdates",
                              )}
                            </SourceButton>
                          )}
                  </SettingsRow>
                )}
                {o.lastError && o.lastError !== o.checkError && (
                  <SettingsRow
                    title={t("provider.settings.diagnostics")}
                    description={
                      <span className="provider-settings-error">
                        {t("provider.lastError", { detail: o.lastError })}
                      </span>
                    }
                  />
                )}
              </SettingsCard>
            </SettingsSection>
          )}
          {o.id === "claude" && props.promptCache}
          {props.modelVisibility?.(o.id)}
        </>
      )}
      {error && (
        <p className="provider-settings-error" role="alert">
          {error}
        </p>
      )}
      <SourceConfirmDialog
        open={disconnect}
        title={t("provider.settings.disconnectTitle", { name: o.email ?? o.name })}
        description={[
          t("provider.settings.disconnectHost", { provider: o.name }),
          used?.length
            ? t("provider.settings.accountBlocked", { agents: names(used) })
            : used
              ? t("provider.settings.removeUnused")
              : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("provider.account.disconnect")}
        onCancel={() => setDisconnect(false)}
        onConfirm={async () => {
          if (a.signOut) await run(() => a.signOut!(o.id));
          setDisconnect(false);
        }}
      />
    </>
  );
}
function Accounts({
  option: o,
  actions: a,
  usage,
  disabled,
}: {
  option: ProviderSettingsOption;
  actions: ProviderSettingsActions;
  usage: readonly AccountUsageProviderRow[];
  disabled?: boolean | undefined;
}) {
  const gt = useGT();
  const [removing, setRemoving] = useState<ProviderSettingsAccount | null>(null),
    [disconnect, setDisconnect] = useState<ProviderSettingsAccount | null>(null),
    [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<ProviderSettingsAccount | null>(null),
    [credits, setCredits] = useState<readonly { accountId: string; available: number }[]>([]),
    [notice, setNotice] = useState<string | null>(null);
  const accounts = o.accounts ?? [];
  const accountKey = accounts.map((a) => `${a.id}:${a.state}`).join();
  const canReset = Boolean(a.usageResets);
  const loadCredits = useEffectEvent(async (_accountKey: string, _canReset: boolean) =>
    a.usageResets ? await a.usageResets() : [],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Re-read credits when the source account list or reset capability changes; discard stale responses.
  useEffect(() => {
    let active = true;
    void loadCredits(accountKey, canReset).then(
      (value) => {
        if (active) setCredits(value);
      },
      () => {
        if (active) setCredits([]);
      },
    );
    return () => {
      active = false;
    };
  }, [accountKey, canReset]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : gt("Account change failed."));
    }
  };
  const name = (id: string) => providerAccountName(t, accounts, id);
  const first = accounts[0];
  return (
    <SettingsSection
      title={t("provider.settings.accounts")}
      description={t("provider.settings.accountsDescription", { count: accounts.length, max: 10 })}
      actions={
        a.connect && (
          <SourceButton
            aria-label={t("provider.account.addLabel", { name: o.name })}
            disabled={
              disabled ||
              a.accountConnect === false ||
              accounts.length >= 10 ||
              accounts.some((a) => a.state === "connecting" && a.email == null)
            }
            onClick={() => a.connect?.(o.id, null)}
          >
            <UserRoundPlus />
            {t("provider.account.add")}
          </SourceButton>
        )
      }
    >
      <div
        className="ui-item-group settings-modal-card"
        aria-label={t("provider.account.listLabel", { name: o.name })}
      >
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            option={o}
            account={account}
            actions={a}
            usage={usage.find(
              (u) => u.provider === o.id && (u.accountId ?? "default") === account.id,
            )}
            disabled={disabled}
            run={run}
            onRemove={() => setRemoving(account)}
            resetsLeft={credits.find((row) => row.accountId === account.id)?.available ?? 0}
            onReset={() => setResetting(account)}
            onDisconnect={() => setDisconnect(account)}
          />
        ))}
      </div>
      {error && (
        <p className="ui-item-description provider-settings-error" role="alert">
          {error}
        </p>
      )}
      <SourceConfirmDialog
        open={removing !== null}
        title={t("provider.settings.removeTitle", { name: removing ? name(removing.id) : "" })}
        description={`${removing?.usedBy?.length ? t("provider.settings.removeMoves", { agents: names(removing.usedBy), name: first ? name(first.id) : "" }) : removing?.usedBy ? t("provider.settings.removeUnused") : ""} ${t("provider.settings.removeCredentials")}`}
        confirmLabel={t("provider.account.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && a.remove) await run(() => a.remove!(o.id, removing.id));
          setRemoving(null);
        }}
      />
      <SourceConfirmDialog
        open={disconnect !== null}
        title={t("provider.settings.disconnectTitle", {
          name: disconnect ? name(disconnect.id) : "",
        })}
        description={[
          t("provider.settings.disconnectHost", { provider: o.name }),
          disconnect?.usedBy?.length
            ? t("provider.settings.accountBlocked", { agents: names(disconnect.usedBy) })
            : disconnect?.usedBy
              ? t("provider.settings.removeUnused")
              : null,
          accounts.length > 1
            ? t("provider.settings.disconnectOthers", { provider: o.name })
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("provider.account.disconnect")}
        onCancel={() => setDisconnect(null)}
        onConfirm={async () => {
          if (a.signOut) await run(() => a.signOut!(o.id));
          setDisconnect(null);
        }}
      />
      {notice && (
        <p className="ui-item-description" role="status">
          {notice}
        </p>
      )}
      <SourceConfirmDialog
        open={resetting !== null}
        tone="default"
        icon={<Gauge />}
        initialFocus="cancel"
        title={t("provider.account.resetUsageTitle", { name: resetting ? name(resetting.id) : "" })}
        description={t("provider.account.resetUsageDescription", {
          count: credits.find((row) => row.accountId === resetting?.id)?.available ?? 0,
        })}
        confirmLabel={t("provider.account.resetUsage")}
        pendingLabel={t("provider.account.resetUsagePending")}
        onCancel={() => setResetting(null)}
        onConfirm={async () => {
          if (!resetting || !a.resetUsage) return;
          const target = resetting;
          await run(async () => {
            const outcome = await a.resetUsage!(target.id);
            const labels = {
              reset: "provider.account.resetUsageDone",
              nothingToReset: "provider.account.resetUsageNothing",
              noCredit: "provider.account.resetUsageNoCredit",
              alreadyRedeemed: "provider.account.resetUsageAlreadyRedeemed",
            };
            setNotice(t(labels[outcome], { name: name(target.id) }));
          });
          setResetting(null);
          if (a.usageResets) setCredits(await a.usageResets());
        }}
      />
    </SettingsSection>
  );
}
function AccountRow({
  option: o,
  account,
  actions: a,
  usage,
  disabled,
  run,
  onRemove,
  onDisconnect,
  resetsLeft,
  onReset,
}: {
  option: ProviderSettingsOption;
  account: ProviderSettingsAccount;
  actions: ProviderSettingsActions;
  usage: AccountUsageProviderRow | undefined;
  disabled: boolean | undefined;
  run: (action: () => Promise<void>) => Promise<void>;
  onRemove: () => void;
  onDisconnect: () => void;
  resetsLeft: number;
  onReset: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const name = providerAccountName(t, o.accounts ?? [], account.id);
  const own = account.id === "default",
    key = isApiKeyAccount(account.id);
  const needsSignIn = account.state === "signed-out" || account.state === "error";
  const stateLabels: Record<string, string> = {
    connecting: "provider.account.finishSignIn",
    checking: "provider.status.checking",
    "signed-out": "provider.status.signInRequired",
    error: "provider.account.failed",
  };
  const detail = [
    account.email && account.email !== name ? account.email : null,
    account.usedBy?.length ? t("provider.account.usedBy", { agents: names(account.usedBy) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ui-item settings-modal-row provider-settings-account">
      <div className="ui-item-content">
        {renaming ? (
          <RenameField
            key={account.id}
            value={account.label ?? ""}
            name={name}
            onDone={(value) => {
              setRenaming(false);
              if (value !== null && value !== (account.label ?? "") && a.rename)
                void run(() => a.rename!(o.id, account.id, value || null));
            }}
          />
        ) : (
          <div className="ui-item-title">{name}</div>
        )}
        {detail && <div className="ui-item-description">{detail}</div>}
        {account.state !== "connected" && (
          <div className={`ui-item-description ${needsSignIn ? "provider-settings-warning" : ""}`}>
            {account.message ??
              (stateLabels[account.state]
                ? t(stateLabels[account.state]!)
                : t("provider.account.failed"))}
            {needsSignIn &&
              Boolean(account.usedBy?.length) &&
              ` ${t("provider.settings.accountBlocked", { agents: names(account.usedBy!) })}`}
          </div>
        )}
      </div>
      <div className="ui-item-actions">
        {usage && account.state === "connected" && <UsageBadge reading={usage} name={name} />}{" "}
        {!own && !key && needsSignIn && a.connect && a.accountConnect !== false && (
          <SourceButton
            variant="default"
            disabled={disabled}
            onClick={() => a.connect?.(o.id, account.id)}
          >
            <LogIn />
            {t("provider.account.signInAgain")}
          </SourceButton>
        )}
        {!own && !key && account.state === "connecting" && a.cancelConnect && (
          <SourceButton disabled={disabled} onClick={() => void run(() => a.cancelConnect!(o.id))}>
            {t("common.cancel")}
          </SourceButton>
        )}
        <Menu.Root>
          <Menu.Trigger
            className="ui-button ui-button-variant-ghost ui-button-size-icon-sm ui-icon-button"
            aria-label={t("provider.account.moreActions", { name })}
            disabled={disabled}
          >
            <Ellipsis aria-hidden="true" />
          </Menu.Trigger>
          <MenuPopup align="end">
            {a.rename && (
              <Menu.Item className="ui-action-menu-item" onClick={() => setRenaming(true)}>
                <Pencil />
                {t("common.rename")}
              </Menu.Item>
            )}
            {account.state === "connected" && !key && resetsLeft > 0 && a.resetUsage && (
              <Menu.Item className="ui-action-menu-item" onClick={onReset}>
                <Gauge />
                {t("provider.account.resetUsage")}
              </Menu.Item>
            )}
            {own && a.connect && (
              <Menu.Item className="ui-action-menu-item" onClick={() => a.connect?.(o.id)}>
                <LogIn />
                {t("provider.action.reconnect")}
              </Menu.Item>
            )}
            {own && <AlternativeItem actions={a} />}
            {key && a.apiKey && (
              <Menu.Item className="ui-action-menu-item" onClick={() => a.apiKey?.(o.id)}>
                <KeyRound />
                {t("provider.settings.changeKey")}
              </Menu.Item>
            )}
            {!own && !key && a.remove && (
              <>
                <Menu.Separator className="ui-action-menu-separator" />
                <Menu.Item className="ui-action-menu-item" onClick={onRemove}>
                  <Trash2 />
                  {t("provider.account.remove")}
                </Menu.Item>
              </>
            )}
            {own && account.state === "connected" && a.signOut && (
              <>
                <Menu.Separator className="ui-action-menu-separator" />
                <Menu.Item className="ui-action-menu-item" onClick={onDisconnect}>
                  <LogOut />
                  {t("provider.account.disconnect")}
                </Menu.Item>
              </>
            )}
          </MenuPopup>
        </Menu.Root>
      </div>
    </div>
  );
}
function RenameField({
  value,
  name,
  onDone,
}: {
  value: string;
  name: string;
  onDone: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focus = useStableCallback((element: HTMLInputElement | null) => {
    element?.focus();
    element?.select();
  });
  return (
    <input
      className="ui-input provider-picker-account-rename"
      maxLength={60}
      aria-label={t("provider.account.renameLabel", { name })}
      placeholder={name}
      value={draft}
      ref={focus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(draft.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
}
function UsageBadge({ reading, name }: { reading: AccountUsageProviderRow; name: string }) {
  const low = reading.windows
    .filter((w) => w.tone !== "neutral")
    .sort((a, b) => a.remainingPercent - b.remainingPercent)[0];
  return low ? (
    <LowUsageBadge
      reading={reading}
      name={name}
      tone={low.tone}
      label={t("provider.settings.usageLow", {
        percent: format.percent(low.remainingPercent / 100),
        window: low.label,
      })}
    />
  ) : null;
}
function LowUsageBadge({
  reading,
  name,
  tone,
  label,
}: {
  reading: AccountUsageProviderRow;
  name: string;
  tone: string;
  label: string;
}) {
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source account reset labels advance every 30 seconds only while the low-limit badge exists.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Popover.Root modal>
      <Popover.Trigger
        className={`z-badge z-badge-variant-${tone === "critical" ? "destructive" : "warning"}-light provider-settings-usage-badge`}
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="openbot-react" side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="ui-popover-menu-surface account-usage-popover">
            <Popover.Title className="sr-only">
              {t("provider.settings.usageOf", { name })}
            </Popover.Title>
            <ul className="account-usage-providers">
              <li className="account-usage-provider">
                <ProviderLogo provider={reading.provider} className="account-usage-provider-logo" />
                <strong className="account-usage-provider-name">{name}</strong>
                <AccountUsageWindowList windows={reading.windows} now={now} />
              </li>
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AlternativeItem({ actions }: { actions: ProviderSettingsActions }) {
  const alternative = actions.alternative;
  return alternative ? (
    <Menu.Item className="ui-action-menu-item" onClick={alternative.run}>
      {alternative.kind === "address" ? (
        <Link aria-hidden="true" />
      ) : (
        <Smartphone aria-hidden="true" />
      )}
      {t(
        alternative.kind === "address"
          ? "provider.action.pasteAddress"
          : "provider.action.signInWithCode",
      )}
    </Menu.Item>
  ) : null;
}
