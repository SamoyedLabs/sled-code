/* oxlint-disable shadcn/no-unknown-classes -- Exact source chart styles. */
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageReport } from "./analytics";
import { ProviderLogo } from "./ProviderLogo";
import { currentText } from "./text";
import {
  usageSeries,
  usageTotalSeries,
  usageSeriesColor,
  usageProviderName,
  usageCost,
  usageCompact,
  usageExactCost,
  usageNumber,
  type UsageMetric,
} from "./usage-format";
import { T } from "gt-react";
/** Same Recharts composition as upstream UsageChart, retaining unknown cells as gaps. */
export function UsageChart({ result, metric }: { result: UsageReport; metric: UsageMetric }) {
  const { t, format } = currentText();
  const chart = usageSeries(result.providerDaily ?? [], result.daily, metric);
  const named = chart.series[0] !== usageTotalSeries;
  const formatValue = (value: number) =>
    metric === "cost"
      ? usageExactCost(value)
      : t("usage.tokensAmount", { tokens: usageNumber(value) });
  return (
    <section
      className="ui-chart"
      aria-label={t(
        metric === "cost" ? "usage.chart.costDescription" : "usage.chart.tokensDescription",
      )}
    >
      <ResponsiveContainer initialDimension={{ width: 640, height: 300 }}>
        <AreaChart
          data={chart.rows}
          margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
          accessibilityLayer
          role="img"
          tabIndex={0}
          aria-label={t(metric === "cost" ? "usage.chart.costLabel" : "usage.chart.tokensLabel")}
        >
          <CartesianGrid vertical={false} stroke="var(--openbot-border-strong)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickMargin={12}
            stroke="var(--openbot-text-muted)"
            tickFormatter={(value) => {
              const day = new Date(`${String(value)}T12:00:00Z`);
              return Number.isNaN(day.getTime())
                ? String(value)
                : format
                    .date(day, { month: "short", day: "numeric", timeZone: "UTC" })
                    .toUpperCase();
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={80}
            tickCount={4}
            interval={0}
            stroke="var(--openbot-text-muted)"
            tickFormatter={(value) =>
              metric === "cost" ? usageCost(Number(value)) : usageCompact(Number(value))
            }
          />
          <Tooltip
            cursor={{ stroke: "var(--openbot-text-muted)", strokeWidth: 1 }}
            // oxlint-disable-next-line react/no-unstable-nested-components -- Recharts calls this render prop with its current payload; it is not a mounted component type.
            content={({ active, payload, label }) => {
              const rows = (payload ?? [])
                .flatMap((item) =>
                  typeof item.value === "number"
                    ? [{ key: String(item.dataKey ?? item.name ?? ""), value: item.value }]
                    : [],
                )
                .sort((a, b) => b.value - a.value);
              return active && rows.length ? (
                <div className="ui-chart-tooltip" role="tooltip">
                  <strong>{String(label ?? "")}</strong>
                  {rows.map((row) =>
                    named ? (
                      <div key={row.key} className="ui-chart-tooltip-row">
                        <span className="ui-chart-tooltip-mark">
                          <ProviderLogo provider={row.key} className="agent-usage-provider-icon" />
                        </span>
                        <span>{usageProviderName(row.key)}</span>
                        <span className="ui-chart-tooltip-value">{formatValue(row.value)}</span>
                      </div>
                    ) : (
                      <div key={row.key}>{formatValue(row.value)}</div>
                    ),
                  )}
                  {named && rows.length > 1 && (
                    <div className="ui-chart-tooltip-row ui-chart-tooltip-total">
                      <span className="ui-chart-tooltip-mark" />
                      <span>
                        <T>Total</T>
                      </span>
                      <span className="ui-chart-tooltip-value">
                        {formatValue(rows.reduce((sum, row) => sum + row.value, 0))}
                      </span>
                    </div>
                  )}
                </div>
              ) : null;
            }}
          />
          {chart.series.map((provider) => (
            <Area
              key={provider}
              dataKey={provider}
              type="monotone"
              stroke={usageSeriesColor(provider)}
              fill={usageSeriesColor(provider)}
              fillOpacity={0.12}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
