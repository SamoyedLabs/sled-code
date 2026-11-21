/* oxlint-disable shadcn/no-unknown-classes -- Exact scoped OpenBot source selectors. */
import type { ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useOpenbotProviderData } from "./useOpenbotProviderData";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../OpenbotTooltip";
import { AccountUsageDetails } from "./AccountUsageDetails";
import { ProviderLogo } from "./ProviderLogo";
import {
  accountUsageProviderRows,
  accountUsageRings,
  accountUsageRowKey,
  type AccountUsageProviderRow,
} from "./account-usage-view";
import { type AccountUsage, type AgentStatus } from "./types";
import { T } from "gt-react";

export function AccountUsageRings({
  rows,
  onOpen,
}: {
  rows: readonly AccountUsageProviderRow[];
  onOpen: (button: HTMLElement) => void;
}) {
  return (
    <>
      {accountUsageRings(rows).map(({ row, shared }) => (
        <UsageRing key={accountUsageRowKey(row)} row={row} shared={shared} onOpen={onOpen} />
      ))}
    </>
  );
}
function UsageRing({
  row,
  shared,
  onOpen,
}: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
  onOpen: (button: HTMLElement) => void;
}) {
  const rows = [row, ...shared];
  const ringRow = rows.reduce((lowest, next) =>
    (next.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? next : lowest,
  );
  const windows = [...ringRow.ringWindows].reverse().slice(0, 2);
  const label = `${rows.map((item) => item.name).join(", ")} usage: ${rows
    .flatMap((item) => item.windows)
    .map((window) => `${window.label}, ${window.remainingPercent}% remaining`)
    .join(", ")}`;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={250}
        closeDelay={75}
        render={
          <button
            type="button"
            className="window-rail-button window-rail-usage"
            aria-label={label}
            onClick={(event) => onOpen(event.currentTarget)}
          />
        }
      >
        <svg className="window-rail-usage-ring" viewBox="0 0 34 34" fill="none" aria-hidden="true">
          {windows.map((window, index) => (
            <g key={window.label}>
              <circle
                className="window-rail-usage-track"
                cx={17}
                cy={17}
                r={15.875 - index * 4.5}
                strokeWidth={2.25}
              />
              {window.remainingPercent > 0 && (
                <circle
                  className="window-rail-usage-arc"
                  data-usage-tone={window.tone}
                  cx={17}
                  cy={17}
                  r={15.875 - index * 4.5}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray={`${window.remainingPercent} 100`}
                />
              )}
            </g>
          ))}
        </svg>
        <ProviderLogo provider={row.provider} className="window-rail-usage-logo" />
      </TooltipTrigger>
      <TooltipPopup
        side="right"
        align="end"
        className="ui-popover-menu-surface account-usage-popover window-rail-usage-card"
      >
        <AccountUsageDetails
          rows={rows}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={
            <h2 className="account-usage-popover-title">
              <T>Usage</T>
            </h2>
          }
        />
      </TooltipPopup>
    </Tooltip>
  );
}
export function OpenbotAccountUsageRail({
  environmentId,
  hostId,
  onOpen,
  usage: usageOverride,
  status: statusOverride,
  fallback = null,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onOpen: (button: HTMLElement) => void;
  usage?: AccountUsage | null;
  status?: AgentStatus | null;
  fallback?: ReactNode;
}) {
  const data = useOpenbotProviderData(environmentId, hostId);
  const rows = accountUsageProviderRows(
    usageOverride ?? data.usage,
    (statusOverride ?? data.status)?.providers,
  );
  return accountUsageRings(rows).length ? (
    <AccountUsageRings rows={rows} onOpen={onOpen} />
  ) : (
    fallback
  );
}
/** Local custom agents answer in text; upstream deliberately draws no percentage ring. */
export interface CustomAgentUsageRailRow {
  id: string;
  name: string;
  text: string;
}
export function CustomAgentUsageRail({
  rows,
  onOpen,
}: {
  rows: readonly CustomAgentUsageRailRow[];
  onOpen: (button: HTMLElement) => void;
}) {
  return (
    <>
      {rows.map((row) => (
        <Tooltip key={row.id}>
          <TooltipTrigger
            delay={250}
            closeDelay={75}
            render={
              <button
                type="button"
                className="window-rail-button window-rail-usage"
                aria-label={`${row.name} usage`}
                onClick={(event) => onOpen(event.currentTarget)}
              />
            }
          >
            <ProviderLogo
              provider="acp"
              className="window-rail-usage-logo window-rail-agent-usage-logo"
            />
          </TooltipTrigger>
          <TooltipPopup
            side="right"
            align="end"
            className="ui-popover-menu-surface account-usage-popover window-rail-usage-card"
          >
            <div className="window-rail-agent-usage">
              <h2 className="account-usage-popover-title">{row.name}</h2>
              <p className="window-rail-agent-usage-text">{row.text}</p>
            </div>
          </TooltipPopup>
        </Tooltip>
      ))}
    </>
  );
}
