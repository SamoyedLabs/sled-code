/* oxlint-disable t3code/no-native-title-tooltip -- Preserve the pinned source reset timestamp and refresh title attributes inside the existing tooltip card. */
/* oxlint-disable shadcn/no-unknown-classes -- Exact scoped OpenBot source selectors. */
import { useEffect, useState, type ReactNode } from "react";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { ProviderLogo } from "./ProviderLogo";
import {
  accountUsageRowKey,
  accountUsageRowLabel,
  formatUsageResetIn,
  type AccountUsageProviderRow,
  type AccountUsageWindowRow,
} from "./account-usage-view";
import { currentText } from "./text";
import "./AccountUsage.css";
export function AccountUsageDetails(props: {
  rows: readonly AccountUsageProviderRow[];
  loading: boolean;
  error: string | null;
  refreshActive: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
  title: ReactNode;
}) {
  const text = currentText();
  const { t } = text;
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Provider reset labels are a clock, refreshed at the source's 30-second cadence while the card is mounted.
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);
  return (
    <>
      <header className="account-usage-popover-header">
        <div className="account-usage-popover-heading">
          <GaugeIcon aria-hidden="true" />
          {props.title}
        </div>
        <button
          type="button"
          className="ui-button account-usage-refresh"
          aria-label={
            props.refreshActive
              ? t("account.usage.refreshing")
              : props.error
                ? t("common.tryAgain")
                : t("account.usage.refresh")
          }
          title={t("account.usage.refreshTitle")}
          onClick={props.onRefresh}
          disabled={props.refreshDisabled}
        >
          <RefreshCwIcon
            className={props.refreshActive ? "icon-spinning" : ""}
            aria-hidden="true"
          />
        </button>
      </header>
      {props.rows.length === 0 && (
        <p className="account-usage-empty" role="status">
          {t(props.loading ? "account.usage.loading" : "account.usage.empty")}
        </p>
      )}
      {props.rows.length > 0 && (
        <ul className="account-usage-providers" aria-label={t("account.usage.providers")}>
          {props.rows.map((row) => (
            <li
              key={accountUsageRowKey(row)}
              className="account-usage-provider"
              aria-label={accountUsageRowLabel(row, text, props.loading)}
            >
              <ProviderLogo provider={row.provider} className="account-usage-provider-logo" />
              {row.windows.length > 0 ? (
                <>
                  <strong className="account-usage-provider-name">{row.name}</strong>
                  <AccountUsageWindowList windows={row.windows} now={now} />
                </>
              ) : (
                <>
                  <span className="account-usage-provider-copy">
                    <strong className="account-usage-provider-name">{row.name}</strong>
                    <span className="account-usage-provider-meta">
                      {t(
                        !row.reportsUsage
                          ? "account.usage.providerNotReported"
                          : props.loading
                            ? "account.usage.window.limit"
                            : "account.usage.notReported",
                      )}
                    </span>
                  </span>
                  <strong className="account-usage-provider-remaining">
                    {t(
                      !row.reportsUsage
                        ? "account.usage.value.notReported"
                        : props.loading
                          ? "account.usage.value.loading"
                          : "account.usage.value.unavailable",
                    )}
                  </strong>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.error && <p className="account-usage-popover-error">{props.error}</p>}
    </>
  );
}
export function AccountUsageWindowList({
  windows,
  now,
}: {
  windows: readonly AccountUsageWindowRow[];
  now: number;
}) {
  const text = currentText();
  return (
    <span className="account-usage-windows">
      {windows.map((window) => (
        <span key={window.label} className="account-usage-window" data-usage-tone={window.tone}>
          <span className="account-usage-window-label">{window.label}</span>
          <span className="account-usage-window-bar" aria-hidden="true">
            <span
              className="account-usage-window-fill"
              style={{ inlineSize: `${window.remainingPercent}%` }}
            />
          </span>
          <strong className="account-usage-window-remaining">
            {text.format.percent(window.remainingPercent / 100)}
          </strong>
          <span
            className="account-usage-window-reset"
            title={
              window.resetsAtLabel
                ? text.t("account.usage.resetsAt", { time: window.resetsAtLabel })
                : undefined
            }
          >
            {formatUsageResetIn(window.resetsAt, now, text)}
          </span>
        </span>
      ))}
    </span>
  );
}
