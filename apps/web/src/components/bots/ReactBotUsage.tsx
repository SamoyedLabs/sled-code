/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot Usage panel/report DOM and styles. */
import { useRef, useState } from "react";
import * as Result from "effect/Result";
import type { EnvironmentId } from "@t3tools/contracts";
import { workflowAgents } from "@t3tools/client-runtime/openbot/presentation";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { SourceUsageDetails } from "./SourceProviderEnvironment";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { OpenbotSlidingTabs } from "./upstream/OpenbotSlidingTabs";
import { SourceSelect } from "./upstream/provider/SourceSelect";
import { ProviderLogo } from "./upstream/provider/ProviderLogo";
import { UsageChart } from "./upstream/provider/UsageChart";
import {
  analyticsTokens,
  decodeReport,
  type UsageReport,
  type Total,
} from "./upstream/provider/analytics";
import { currentText } from "./upstream/provider/text";
import {
  usageCost,
  usageExactCost,
  usageCompact,
  usageNumber,
  usageProviderName,
  usageProviders,
  usageSeriesColor,
  usagePeriods,
  usagePeriodDays,
  usagePeriodLabels,
  usageMetricLabels,
  type UsageMetric,
  type UsagePeriod,
} from "./upstream/provider/usage-format";
import "./upstream/provider/AgentUsage.css";
import "./upstream/provider/SourceControls.css";
import { useGT } from "gt-react";
const text = currentText();
const { t } = text;
function range(days: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const endDate = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  const start = new Date(`${endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate, timeZone };
}
export function ReactBotUsage({
  environmentId,
  hostId,
  hostName = "Workspace",
  initialAgentId,
  onBack,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  initialAgentId?: string;
  onBack?: () => void;
}) {
  const gt = useGT();
  const [agentId, setAgentId] = useState(initialAgentId ?? "");
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [metric, setMetric] = useState<UsageMetric>("cost");
  const [selectedRange, setSelectedRange] = useState(() => range(30));
  const body = useRef<HTMLDivElement>(null);
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "workspace.analytics",
          ...selectedRange,
          ...(agentId ? { agentId } : {}),
        },
      },
    }),
  );
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = workflowAgents(agentsQuery.data);
  const parsed = decodeReport(query.data);
  const report =
    Result.isSuccess(parsed) &&
    parsed.success.startDate === selectedRange.startDate &&
    parsed.success.endDate === selectedRange.endDate &&
    parsed.success.timeZone === selectedRange.timeZone &&
    (parsed.success.agentId ?? "") === agentId
      ? parsed.success
      : null;
  const label = (id: string) => ({
    name:
      id === "openbot:workflows"
        ? "Workflows"
        : (agents.find((agent) => agent.id === id)?.name ?? id),
    provider: agents.find((agent) => agent.id === id)?.provider ?? "",
  });
  const options = [
    { id: "", name: t("usage.panel.allAgents") },
    ...[
      ...new Set([
        ...agents.map((agent) => agent.id),
        ...(report?.agents.some((agent) => agent.agentId === "openbot:workflows")
          ? ["openbot:workflows"]
          : []),
        ...(agentId ? [agentId] : []),
      ]),
    ].map((id) => ({ id, name: label(id).name })),
  ];
  return (
    <section className="agent-usage" aria-label={t("usage.panel.label")}>
      <header className="agent-usage-header">
        <div className="agent-usage-identity">
          {onBack && (
            <button
              type="button"
              className="ui-button ui-icon-button"
              aria-label={gt("Back")}
              onClick={onBack}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </button>
          )}
          <h2 tabIndex={-1}>
            {t("usage.panel.title")} <span aria-hidden="true">/</span>
            <span>{hostName}</span>
          </h2>
        </div>
        <div className="agent-usage-controls">
          <SourceSelect
            value={agentId}
            onChange={(value) => {
              setAgentId(value);
              body.current?.scrollTo({ top: 0 });
            }}
            options={options}
            label={t("usage.panel.agents")}
          />
          <SourceSelect
            value={metric}
            onChange={(value) => {
              if (value === "cost" || value === "tokens") setMetric(value);
            }}
            options={(["cost", "tokens"] as const).map((id) => ({
              id,
              name: t(usageMetricLabels[id]),
            }))}
            label={t("usage.panel.metric")}
          />
          <SourceSelect
            value={period}
            onChange={(value) => {
              const next = usagePeriods.find((period) => period === value);
              if (next) {
                setPeriod(next);
                setSelectedRange(range(usagePeriodDays[next]));
                body.current?.scrollTo({ top: 0 });
              }
            }}
            options={usagePeriods.map((id) => ({ id, name: t(usagePeriodLabels[id]) }))}
            label={t("usage.panel.period")}
          />
          <button
            type="button"
            className="ui-button ui-icon-button"
            aria-label={t("usage.panel.refresh")}
            disabled={query.isPending}
            onClick={() => {
              setSelectedRange(range(usagePeriodDays[period]));
              query.refresh();
              agentsQuery.refresh();
            }}
          >
            <RefreshCwIcon aria-hidden="true" />
          </button>
        </div>
      </header>
      <div ref={body} className="agent-usage-body">
        <SourceUsageDetails />
        {query.isPending && (
          <div className="agent-usage-loading" role="status">
            <span>{t("usage.panel.loading")}</span>
            <div className="agent-usage-placeholder" />
          </div>
        )}
        {query.error && (
          <div className="agent-usage-notice">
            <p role="alert">{query.error}</p>
            <button type="button" className="ui-button" onClick={query.refresh}>
              {t("common.retry")}
            </button>
          </div>
        )}
        {!query.isPending && !query.error && !report && (
          <p className="agent-usage-notice" role="status">
            {t("usage.panel.unsupported")}
          </p>
        )}
        {report && <UsageReportView report={report} metric={metric} agentLabel={label} />}
      </div>
    </section>
  );
}
function Amount({ value, cost = false }: { value: number | null; cost?: boolean }) {
  return (
    <>
      <span aria-hidden="true">{cost ? usageCost(value) : usageCompact(value)}</span>
      <span className="sr-only">{cost ? usageExactCost(value) : usageNumber(value)}</span>
    </>
  );
}
const totalRows = [
  { field: "processedTokens", label: "usage.totals.processedTokens" },
  { field: "cachedInput", label: "usage.totals.cachedInput" },
  { field: "uncachedInput", label: "usage.totals.uncachedInput" },
  { field: "cacheCreation", label: "usage.totals.cacheCreation" },
  { field: "output", label: "usage.totals.output" },
  { field: "userMessages", label: "usage.totals.userMessages" },
  { field: "assistantMessages", label: "usage.totals.assistantMessages" },
] as const;
function UsageReportView({
  report,
  metric,
  agentLabel,
}: {
  report: UsageReport;
  metric: UsageMetric;
  agentLabel: (id: string) => { name: string; provider: string };
}) {
  const [breakdown, setBreakdown] = useState("agent");
  const dailyTable = useRef<HTMLTableElement>(null);
  const cost = metric === "cost";
  const totals = report.totals;
  const providers = usageProviders(report.models).sort((a, b) =>
    cost ? (b.cost ?? -1) - (a.cost ?? -1) : b.tokens - a.tokens,
  );
  const sort = (a: Total, b: Total) =>
    cost
      ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1)
      : analyticsTokens(b) - analyticsTokens(a);
  const models = [...report.models].sort(sort);
  const agents = [...report.agents].sort(sort);
  const share = (value: number | null) => {
    const total = cost ? totals.estimatedCostUsd : analyticsTokens(totals);
    return value === null || total === null
      ? t("usage.unavailable")
      : text.format.percent(total ? value / total : 0, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  };
  const cells = (row: Total) => (
    <>
      <td>
        <Amount value={row.estimatedCostUsd} cost />
      </td>
      <td>{share(cost ? row.estimatedCostUsd : analyticsTokens(row))}</td>
      <td>
        <Amount value={analyticsTokens(row)} />
      </td>
    </>
  );
  const columns = (label: string) => (
    <tr>
      <th scope="col">{label}</th>
      <th scope="col">{t("usage.column.cost")}</th>
      <th scope="col">{t("usage.column.share")}</th>
      <th scope="col">{t("usage.column.tokens")}</th>
    </tr>
  );
  return (
    <>
      {!totals.turns && !totals.userMessages && !totals.processedTokens && (
        <p className="agent-usage-notice" role="status">
          {t("usage.empty")}
        </p>
      )}
      {(totals.missingUsageTurns > 0 ||
        totals.unpricedRecords > 0 ||
        totals.incompleteRecords > 0) && (
        <p className="agent-usage-notice" role="status">
          {t("usage.partial", {
            turns: totals.missingUsageTurns,
            unpriced: totals.unpricedRecords,
            incomplete: totals.incompleteRecords,
          })}
        </p>
      )}
      <div className="agent-usage-overview">
        <section className="agent-usage-summary" aria-label={t("usage.summary")}>
          <div>
            <p className="agent-usage-hero">
              <Amount
                value={cost ? totals.estimatedCostUsd : analyticsTokens(totals)}
                cost={cost}
              />
            </p>
            <p className="agent-usage-secondary">
              {usageNumber(totals.sessions)} {totals.sessions === 1 ? "session" : "sessions"} ·{" "}
              {t(cost ? "usage.costEstimate" : "usage.knownTokens")}
            </p>
          </div>
          <div className="agent-usage-providers">
            {providers.map((provider) => (
              <div className="agent-usage-provider" key={provider.provider}>
                <div className="agent-usage-provider-heading">
                  <span>
                    <span
                      className="agent-usage-series-dot"
                      style={{ background: usageSeriesColor(provider.provider) }}
                      aria-hidden="true"
                    />
                    <ProviderLogo
                      provider={provider.provider}
                      className="agent-usage-provider-icon"
                    />
                    {usageProviderName(provider.provider)}
                  </span>
                  <strong>
                    <Amount value={cost ? provider.cost : provider.tokens} cost={cost} />
                  </strong>
                </div>
                <p>
                  {(!cost || provider.cost !== null) && (
                    <>
                      {t(cost ? "usage.provider.shareOfCost" : "usage.provider.shareOfTokens", {
                        share: share(cost ? provider.cost : provider.tokens),
                      })}{" "}
                      ·{" "}
                    </>
                  )}
                  {cost
                    ? t("usage.tokensAmount", { tokens: usageCompact(provider.tokens) })
                    : usageCost(provider.cost)}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="agent-usage-trend" aria-label={t("usage.dailyTrend")}>
          <div className="agent-usage-section-header">
            <h3>{t(cost ? "usage.dailyCost" : "usage.dailyTokens")}</h3>
            <button
              type="button"
              className="ui-button"
              onClick={() => {
                setBreakdown("day");
                queueMicrotask(() => dailyTable.current?.focus());
              }}
            >
              {t("usage.viewDailyData")}
            </button>
          </div>
          <UsageChart result={report} metric={metric} />
        </section>
      </div>
      <section aria-label={t("usage.totals.title")}>
        <h3>{t("usage.totals.title")}</h3>
        <dl className="agent-usage-totals">
          <div>
            <dt>{t("usage.totals.tokens")}</dt>
            <dd>
              <Amount value={analyticsTokens(totals)} />
            </dd>
          </div>
          {totalRows.map((row) => (
            <div key={row.field}>
              <dt>{t(row.label)}</dt>
              <dd>
                <Amount value={totals[row.field]} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <div className="agent-usage-section-header">
          <h3>{t("usage.breakdown.title")}</h3>
          <OpenbotSlidingTabs
            value={breakdown}
            onChange={setBreakdown}
            items={[
              { value: "model", label: t("usage.breakdown.model") },
              { value: "agent", label: t("usage.breakdown.agent") },
              { value: "day", label: t("usage.breakdown.day") },
            ]}
            label={t("usage.breakdown.label")}
          />
        </div>
        <div className="ui-sliding-tabs-content-slot">
          <div
            role="tabpanel"
            inert={breakdown !== "model"}
            aria-hidden={breakdown !== "model"}
            data-selected={breakdown === "model" ? "" : undefined}
            className="ui-sliding-tabs-content agent-usage-table"
          >
            <table>
              <caption className="sr-only">{t("usage.breakdown.byModel")}</caption>
              <thead>{columns(t("usage.breakdown.model"))}</thead>
              <tbody>
                {models.map((model) => (
                  <tr key={`${model.provider}:${model.model}`}>
                    <th scope="row">
                      <span className="agent-usage-model-name">
                        <ProviderLogo
                          provider={model.provider}
                          className="agent-usage-provider-icon"
                        />
                        <span>
                          {model.model || t("usage.unknownModel")}
                          <span className="sr-only">{usageProviderName(model.provider)}</span>
                        </span>
                      </span>
                    </th>
                    {cells(model)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            role="tabpanel"
            inert={breakdown !== "agent"}
            aria-hidden={breakdown !== "agent"}
            data-selected={breakdown === "agent" ? "" : undefined}
            className="ui-sliding-tabs-content agent-usage-table"
          >
            <table>
              <caption className="sr-only">{t("usage.breakdown.byAgent")}</caption>
              <thead>{columns(t("usage.breakdown.agent"))}</thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <th scope="row">
                      <span className="agent-usage-model-name">
                        <ProviderLogo
                          provider={agentLabel(agent.agentId).provider}
                          className="agent-usage-provider-icon"
                        />
                        <span>{agentLabel(agent.agentId).name}</span>
                      </span>
                    </th>
                    {cells(agent)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            role="tabpanel"
            inert={breakdown !== "day"}
            aria-hidden={breakdown !== "day"}
            data-selected={breakdown === "day" ? "" : undefined}
            className="ui-sliding-tabs-content agent-usage-table"
          >
            <table ref={dailyTable} tabIndex={-1}>
              <caption className="sr-only">{t("usage.breakdown.byDay")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("usage.column.date")}</th>
                  <th scope="col">{t("usage.column.costUsd")}</th>
                  <th scope="col">{t("usage.column.tokens")}</th>
                </tr>
              </thead>
              <tbody>
                {[...report.daily].reverse().map((day) => (
                  <tr key={day.date}>
                    <th scope="row">{day.date}</th>
                    <td>{usageExactCost(day.estimatedCostUsd)}</td>
                    <td>{usageNumber(analyticsTokens(day))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <footer className="agent-usage-footer">
        <p>
          {t("usage.footer", {
            started: text.format.date(new Date(report.collectionStartedAt)),
            updated: report.updatedAt
              ? text.format.date(new Date(report.updatedAt), {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                })
              : t("usage.updatedNever"),
          })}
        </p>
        <details>
          <summary>{t("usage.about.title")}</summary>
          <p>{t("usage.about.body")}</p>
          <p>{t("usage.about.tokens")}</p>
        </details>
      </footer>
    </>
  );
}
