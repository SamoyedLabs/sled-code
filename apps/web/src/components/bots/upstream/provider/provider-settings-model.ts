import type { AgentProviderStatus, ProviderAccountStatus, ProviderRuntimeStatus } from "./types";
import { currentText } from "./text";
export interface ProviderSettingsAccount extends ProviderAccountStatus {
  usedBy?: readonly string[];
}
export interface ProviderSettingsOption extends Omit<AgentProviderStatus, "accounts" | "id"> {
  id: string;
  name: string;
  description?: string;
  accounts?: ProviderSettingsAccount[] | undefined;
  runtimeStatus?: ProviderRuntimeStatus;
  usedBy?: readonly string[];
  keyStatus?: "saved" | "missing" | "unreadable";
}
const { t, format } = currentText();
export function providerSettingsLabel(option: ProviderSettingsOption) {
  const runtime = option.runtimeStatus;
  if (option.off) return t("provider.status.off");
  if (runtime?.phase === "downloading" && runtime.message)
    return t("provider.status.updateWaiting");
  if (runtime?.phase === "downloading")
    return format.percent(Math.round(Math.max(0, Math.min(100, runtime.progress ?? 0))) / 100);
  if (runtime?.phase === "finishing") return t("provider.status.settingUp");
  if (option.connectionState === "connecting" && option.state !== "available")
    return t("provider.status.connecting");
  if (runtime?.phase === "download-error")
    return t(runtime.version ? "provider.status.updateFailed" : "provider.status.setupFailed");
  if (option.state === "available") return t("provider.status.connected");
  if (runtime?.phase === "not-downloaded") return t("provider.status.notDownloaded");
  if (option.state === "sign-in-required") return t("provider.status.notConnected");
  if (option.state === "outdated") return t("provider.status.updateRequired");
  if (option.state === "error") return t("provider.status.unavailable");
  if (runtime?.phase === "ready") return t("provider.status.ready");
  if (option.state === "not-installed") return t("provider.status.notInstalled");
  return option.state === "checking" ? t("provider.status.checking") : option.state;
}
export function waitingAccounts(option: ProviderSettingsOption) {
  return (option.accounts ?? []).filter((a) => a.state === "signed-out" || a.state === "error")
    .length;
}
export function providerSettingsSummary(option: ProviderSettingsOption) {
  if (option.off) return t("provider.status.off");
  if (option.runtimeStatus?.phase === "not-downloaded") return t("provider.status.notDownloaded");
  if (option.connectionState === "connecting") return t("provider.status.connecting");
  if (option.state !== "available") return providerSettingsLabel(option);
  const accounts = option.accounts ?? [];
  if (accounts.length > 1) {
    const count = t("provider.account.count", { count: accounts.length });
    const waiting = waitingAccounts(option);
    return waiting
      ? t("provider.settings.accountsWaiting", { count: waiting, accounts: count })
      : count;
  }
  return option.email ?? option.description ?? t("provider.status.connected");
}
export function providerSettingsRows(options: readonly ProviderSettingsOption[], query: string) {
  const needle = query.trim().toLowerCase();
  const shown = options.filter((o) =>
    [
      o.name,
      providerSettingsSummary(o),
      o.email,
      ...(o.accounts ?? []).flatMap((a) => [a.label, a.email]),
    ].some((text) => !needle || text?.toLowerCase().includes(needle)),
  );
  const connected = (o: ProviderSettingsOption) =>
    !o.off && (o.state === "available" || o.connectionState === "connecting");
  return { connected: shown.filter(connected), other: shown.filter((o) => !connected(o)) };
}
export function providerUpdateAvailable(runtime: ProviderRuntimeStatus) {
  return (
    (runtime.phase === "ready" ||
      (runtime.phase === "not-downloaded" && runtime.version !== null)) &&
    runtime.availableVersion != null &&
    runtime.availableVersion !== runtime.version
  );
}
export function codeSignInSupported(provider: string, capabilities: readonly string[]) {
  if (provider === "claude") return capabilities.includes("providers-v3");
  if (provider === "codex") return capabilities.includes("providers-v1");
  if (provider === "grok") return capabilities.includes("providers-v3");
  if (provider === "cursor" || provider === "cline") return capabilities.includes("providers-v4");
  return provider === "kimi" && capabilities.includes("providers-v8");
}
export function codeSignInStatus(
  started: boolean,
  row: { state: string; message: string | null; connectionState?: string | undefined } | undefined,
) {
  if (!row) return { started, outcome: null };
  if (row.connectionState === "connecting") return { started: true, outcome: null };
  if (!started) return { started: false, outcome: null };
  return {
    started: false,
    outcome:
      row.state === "available" && !row.message ? ("connected" as const) : ("failed" as const),
  };
}

export type ProviderLoginMethod = "code" | "relay" | "host-page";
export function providerWebConnectRoute(
  provider: string,
  capabilities: readonly string[],
  hostPage: boolean,
) {
  const code = codeSignInSupported(provider, capabilities);
  const relay =
    capabilities.includes("sign-in-relay-v1") &&
    ["codex", "claude", "antigravity", "muse"].includes(provider);
  const connect: ProviderLoginMethod | "use-app" | null = code
    ? "code"
    : hostPage
      ? "host-page"
      : relay && provider === "muse"
        ? "relay"
        : relay
          ? "use-app"
          : null;
  return { connect, alternative: connect !== "relay" && relay ? ("relay" as const) : null };
}
