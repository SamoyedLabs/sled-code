import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  analyticsTokens,
  decodeAgentReport,
  decodeReport,
  type UsageReport,
} from "@t3tools/client-runtime/openbot/usage-analytics";
import { usageSeries, usageTotalSeries } from "@t3tools/client-runtime/openbot/usage-series";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Button } from "../../components/ui/Button";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { BotMarketplace } from "./BotMarketplace";
import { BotEvents } from "./BotEvents";
import { BotRoutineCalendar } from "./BotRoutineCalendar";
import { BotRoutineFlows } from "./BotRoutineFlows";
import { BotUsageLimits } from "./BotUsageLimits";
import { BotUsageDateRange } from "./BotUsageDateRange";
import { UsageChart, useUsageSeriesColor } from "./upstream/BotUsageChart";
import { BotAvatar } from "./upstream/BotAvatar";
import { m } from "../../i18n/messages";
import { msg, useGT } from "gt-react-native";

type Host = { environmentId: EnvironmentId; hostId: string };
type UsageRange = ReturnType<typeof lastUsageDays>;
type UsageTarget = { id: string; name: string; range: UsageRange; period: UsagePeriod };
type UsagePeriod = 7 | 30 | 90 | 365 | "custom";

type Utility = Host & { page: "routines" | "usage" | "marketplace"; agent?: UsageTarget };

export function BotWorkspaceUtilityRoute({ route }: StaticScreenProps<Utility>) {
  return <BotWorkspaceUtility {...route.params} />;
}

export function BotScheduleRoute({ route }: StaticScreenProps<Host>) {
  const gt = useGT();
  const { environmentId, hostId } = route.params;
  const status = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  if (status.data?.state === "ready" && status.data.hostId === hostId)
    return <BotWorkspaceUtility page="routines" environmentId={environmentId} hostId={hostId} />;
  return (
    <SettingsScreen title={gt("Routines")}>
      <ScreenScrollView contentContainerClassName="gap-3 px-5 py-4">
        <Text className="text-foreground-muted">
          {status.error ??
            (status.isPending
              ? gt("Connecting to the bot computer…")
              : gt("This bot computer is unavailable."))}
        </Text>
        {!status.isPending && (
          <Button label={gt("Retry")} size="compact" onPress={status.refresh} />
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function BotWorkspaceUtility({ page, environmentId, hostId, agent }: Utility) {
  const gt = useGT();
  return (
    <SettingsScreen
      title={
        page === "marketplace"
          ? gt("Marketplace")
          : page === "routines"
            ? gt("Routines")
            : agent
              ? `${agent.name} usage`
              : gt("Usage")
      }
    >
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        {page === "marketplace" ? (
          <BotMarketplace environmentId={environmentId} hostId={hostId} />
        ) : page === "routines" ? (
          <>
            <BotRoutineCalendar environmentId={environmentId} hostId={hostId} />
            <BotEvents environmentId={environmentId} hostId={hostId} />
            <BotRoutineFlows environmentId={environmentId} hostId={hostId} />
          </>
        ) : (
          <BotWorkspaceUsage environmentId={environmentId} hostId={hostId} agent={agent} />
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

const usagePeriods = [
  { value: 7, label: m(msg("7 days")) },
  { value: 30, label: m(msg("30 days")) },
  { value: 90, label: m(msg("90 days")) },
  { value: 365, label: m(msg("1 year")) },
] as const;
const customUsagePeriods = [...usagePeriods, { value: "custom", label: m(msg("Custom")) }] as const;
const chartMetrics = [
  { value: "tokens", label: m(msg("Tokens")) },
  { value: "cost", label: m(msg("Cost")) },
] as const;

function isoDay(day: Date) {
  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()))
    .toISOString()
    .slice(0, 10);
}

function localDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, 12);
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function lastUsageDays(days: number) {
  const endDate = isoDay(new Date());
  return {
    startDate: shiftDay(endDate, 1 - days),
    endDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function BotWorkspaceUsage({
  environmentId,
  hostId,
  agent,
}: Host & { agent?: UsageTarget | undefined }) {
  const gt = useGT();
  const navigation = useNavigation();
  const [period, setPeriod] = useState<UsagePeriod>(agent?.period ?? 30);
  const [range, setRange] = useState(() => agent?.range ?? lastUsageDays(30));
  const [today] = useState(() => new Date());
  const usage = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: {
        hostId,
        request: agent
          ? { operation: "agent.analytics", agentId: agent.id, ...range }
          : { operation: "workspace.analytics", ...range },
      },
    }),
  );
  const agents = useEnvironmentQuery(agent ? null : openbot.agents({ environmentId, input: {} }));
  const agentId = agent?.id;
  const selected = useMemo<UsageReport | null>(() => {
    if (agentId) {
      const decoded = decodeAgentReport(usage.data);
      return Result.isSuccess(decoded) && decoded.success.agentId === agentId
        ? { ...decoded.success, agents: [] }
        : null;
    }
    const decoded = decodeReport(usage.data);
    return Result.isSuccess(decoded) && decoded.success.agentId === undefined
      ? decoded.success
      : null;
  }, [agentId, usage.data]);
  const [previous, setPrevious] = useState<UsageReport | null>(null);
  if (selected !== null && selected !== previous) setPrevious(selected);
  const report = selected ?? (usage.isPending ? previous : null);
  const number = new Intl.NumberFormat();
  const currency = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const summarize = (value: number | null) =>
    value === null ? "Unavailable" : number.format(value);

  return (
    <View className="gap-4">
      {!agent && <BotUsageLimits environmentId={environmentId} hostId={hostId} />}
      <SegmentedControl
        options={Platform.OS === "ios" ? customUsagePeriods : usagePeriods}
        selected={period}
        onSelect={(days) => {
          setPeriod(days);
          if (days !== "custom") setRange(lastUsageDays(days));
        }}
      />
      {period === "custom" && (
        <SettingsSection>
          <View className="px-4 py-3">
            <BotUsageDateRange
              start={localDay(range.startDate)}
              end={localDay(range.endDate)}
              today={today}
              onStart={(day) => {
                const startDate = isoDay(day);
                const endDate = startDate > range.endDate ? startDate : range.endDate;
                const maxEnd = shiftDay(startDate, 366);
                setRange({ ...range, startDate, endDate: endDate < maxEnd ? endDate : maxEnd });
              }}
              onEnd={(day) => {
                const endDate = isoDay(day);
                const startDate = endDate < range.startDate ? endDate : range.startDate;
                const minStart = shiftDay(endDate, -366);
                setRange({
                  ...range,
                  endDate,
                  startDate: startDate > minStart ? startDate : minStart,
                });
              }}
            />
          </View>
        </SettingsSection>
      )}
      {report === null ? (
        <View className="gap-2 px-2 py-3">
          <Text accessibilityRole={usage.error ? "alert" : "status"}>
            {usage.error ?? (usage.isPending ? gt("Loading usage…") : gt("Usage is unavailable."))}
          </Text>
          {usage.error && <Button label={gt("Retry")} tone="secondary" onPress={usage.refresh} />}
        </View>
      ) : (
        <>
          <Text className="text-center text-xs text-foreground-muted">
            {report.startDate} – {report.endDate} · {report.timeZone}
          </Text>
          <View className="flex-row gap-3">
            <UsageTotal
              label={gt("Tokens without cache reads")}
              value={number.format(analyticsTokens(report.totals))}
            />
            <UsageTotal
              label={gt("Estimated cost")}
              value={
                report.totals.estimatedCostUsd === null
                  ? "Unavailable"
                  : currency.format(report.totals.estimatedCostUsd)
              }
            />
          </View>
          <UsageDaily report={report} />
          <SettingsSection title={gt("Activity")}>
            <UsageRow label={gt("Sessions")} value={summarize(report.totals.sessions)} />
            <UsageRow label={gt("User messages")} value={summarize(report.totals.userMessages)} />
            <UsageRow
              label={gt("Assistant messages")}
              value={summarize(report.totals.assistantMessages)}
            />
          </SettingsSection>
          <SettingsSection title={gt("Token breakdown")}>
            <UsageRow label={gt("Uncached input")} value={summarize(report.totals.uncachedInput)} />
            <UsageRow label={gt("Cache reads")} value={summarize(report.totals.cachedInput)} />
            <UsageRow label={gt("Cache writes")} value={summarize(report.totals.cacheCreation)} />
            <UsageRow label={gt("Output")} value={summarize(report.totals.output)} />
          </SettingsSection>
          {!agent && (
            <SettingsSection title={gt("Agents")}>
              {report.agents.length === 0 && (
                <UsageRow label={gt("No usage recorded for agents")} value="" />
              )}
              {[...report.agents]
                .sort((a, b) => analyticsTokens(b) - analyticsTokens(a))
                .map((row) => {
                  const matched = agents.data?.find((item) => item.id === row.agentId);
                  const name =
                    matched?.name ??
                    (row.agentId === "openbot:workflows" ? "Workflows" : row.agentId);
                  const value = summarize(analyticsTokens(row)) + " tokens";
                  const cost =
                    row.estimatedCostUsd === null
                      ? "Unavailable"
                      : currency.format(row.estimatedCostUsd);
                  if (!matched) return <UsageRow key={row.agentId} label={name} value={value} />;
                  return (
                    <Pressable
                      key={row.agentId}
                      accessibilityRole="button"
                      accessibilityLabel={`${name}, ${value}, ${cost}`}
                      onPress={() =>
                        navigation.dispatch(
                          StackActions.push("BotWorkspaceUtility", {
                            environmentId,
                            hostId,
                            page: "usage",
                            agent: {
                              id: row.agentId,
                              name,
                              range: {
                                startDate: report.startDate,
                                endDate: report.endDate,
                                timeZone: report.timeZone,
                              },
                              period,
                            },
                          }),
                        )
                      }
                      className="min-h-12 flex-row items-center gap-3 px-4 py-2 active:opacity-60"
                    >
                      <BotAvatar
                        seed={matched.avatarSeed || matched.id}
                        hue={matched.avatarHue}
                        size={32}
                      />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1}>{name}</Text>
                        <Text className="text-xs text-foreground-muted">
                          {value} · {cost}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
            </SettingsSection>
          )}
          <SettingsSection title={gt("Models")}>
            {report.models.length === 0 && (
              <UsageRow label={gt("No model usage recorded")} value="" />
            )}
            {[...report.models]
              .sort((a, b) => analyticsTokens(b) - analyticsTokens(a))
              .map((model) => (
                <View key={`${model.provider}:${model.model}`} className="gap-1 px-4 py-3">
                  <Text>{model.model || gt("Unknown model")}</Text>
                  <Text className="text-xs text-foreground-muted">
                    {model.provider} · {summarize(analyticsTokens(model))} tokens
                    {model.estimatedCostUsd !== null
                      ? ` · ${currency.format(model.estimatedCostUsd)}`
                      : ""}
                  </Text>
                </View>
              ))}
          </SettingsSection>
        </>
      )}
    </View>
  );
}

function UsageDaily({ report }: { report: UsageReport }) {
  const gt = useGT();
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const color = useUsageSeriesColor();
  const chart = useMemo(() => {
    const { series, rows } = usageSeries(report.providerDaily ?? [], report.daily, metric);
    return series.map((key) => ({
      key,
      color: color(key),
      values: rows.map((row) => (typeof row[key] === "number" ? row[key] : null)),
    }));
  }, [color, metric, report]);
  const days = useMemo(() => report.daily.map((day) => day.date), [report]);
  const selected = selectedDate === null ? -1 : days.indexOf(selectedDate);
  const day = report.daily[selected];
  const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const amount = new Intl.NumberFormat(
    undefined,
    metric === "cost"
      ? {
          style: "currency",
          currency: "USD",
          maximumSignificantDigits: 2,
        }
      : { notation: "compact", maximumFractionDigits: 1 },
  );
  const measure = day ? (metric === "cost" ? day.estimatedCostUsd : analyticsTokens(day)) : null;
  return (
    <SettingsSection title={gt("Daily usage")}>
      <View className="gap-3 p-4">
        <SegmentedControl
          options={chartMetrics}
          selected={metric}
          onSelect={setMetric}
          variant="card"
        />
        <UsageChart
          dates={days}
          series={chart}
          selected={selected < 0 ? null : selected}
          onSelect={(index) => setSelectedDate(index === null ? null : (days[index] ?? null))}
          formatValue={(value) =>
            metric === "tokens" ? compactTokens(value) : amount.format(value)
          }
          formatDate={(value) => dateFormatter.format(localDay(value)).toUpperCase()}
          label={metric === "cost" ? gt("Daily estimated cost chart") : gt("Daily tokens chart")}
          value={
            day
              ? `${dateFormatter.format(localDay(day.date))}, ${measure === null ? "Unavailable" : amount.format(measure)}`
              : "Select a day"
          }
        />
        {chart[0]?.key !== usageTotalSeries &&
          chart.map((series) => {
            const value =
              selected < 0
                ? series.values.reduce<number | null>(
                    (sum, v) => (v === null ? sum : (sum ?? 0) + v),
                    null,
                  )
                : series.values[selected];
            return (
              <View key={series.key} className="flex-row items-center gap-2">
                <View className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
                <Text className="flex-1 text-xs">{series.key}</Text>
                <Text className="text-xs text-foreground-muted">
                  {value == null ? gt("Unavailable") : amount.format(value)}
                </Text>
              </View>
            );
          })}
        {day && (
          <Text className="text-xs text-foreground-muted">
            {dateFormatter.format(localDay(day.date))} · {day.sessions} sessions
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}

function compactTokens(value: number) {
  if (value >= 1e9) return `${Number((value / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `${Number((value / 1e3).toFixed(1))}K`;
  return String(Number(value.toPrecision(3)));
}

function UsageTotal({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 justify-between gap-1 rounded-2xl bg-card p-4">
      <Text className="text-xs text-foreground-muted">{label}</Text>
      <Text className="font-t3-semibold text-xl tabular-nums">{value}</Text>
    </View>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3 px-4 py-2">
      <Text className="shrink">{label}</Text>
      <Text className="text-foreground-muted tabular-nums">{value}</Text>
    </View>
  );
}
