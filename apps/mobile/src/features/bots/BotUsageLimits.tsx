import type { EnvironmentId } from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { ProviderIcon } from "../../components/ProviderIcon";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { SettingsSection } from "../settings/components/SettingsSection";
import { BotGlass, useBotPalette } from "./upstream/BotChrome";
import { m } from "../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react-native";

const Finite = Schema.Number.check(Schema.isFinite());
const Window = Schema.Struct({
  usedPercent: Finite,
  windowDurationMins: Schema.NullOr(Finite),
  resetsAt: Schema.NullOr(Finite),
});
const decodeLimits = Schema.decodeUnknownResult(
  Schema.Struct({
    limits: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        accountId: Schema.optional(Schema.String),
        primary: Schema.NullOr(Window),
        secondary: Schema.NullOr(Window),
        tertiary: Schema.optional(Window),
        groups: Schema.optional(
          Schema.Array(
            Schema.Struct({
              name: Schema.String,
              primary: Schema.NullOr(Window),
              secondary: Schema.NullOr(Window),
              tertiary: Schema.optional(Window),
            }),
          ),
        ),
        sharedQuotaWith: Schema.optional(Schema.String),
      }),
    ),
  }),
);

const available = (window: typeof Window.Type) =>
  Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));

const remainingColor = (remaining: number) =>
  remaining <= 5 ? "#ef5b67" : remaining <= 20 ? "#edb25e" : "#45b789";

// OpenBot iOS 1.4.11's even-use mark, including its tolerance for calendar months.
function remainingAtEvenPace({ windowDurationMins, resetsAt }: typeof Window.Type, now: number) {
  if (windowDurationMins === null || windowDurationMins <= 0 || resetsAt === null) return null;
  const minutesLeft = (resetsAt * 1_000 - now) / 60_000;
  if (!(minutesLeft > 0) || minutesLeft > windowDurationMins * 1.05) return null;
  return Math.min(100, (minutesLeft / windowDurationMins) * 100);
}

function duration(minutes: number | null) {
  if (!minutes) return m(msg("Plan limit"));
  const [count, unit] =
    minutes % 1440 === 0
      ? [minutes / 1440, "day"]
      : minutes % 60 === 0
        ? [minutes / 60, "hour"]
        : [minutes, "minute"];
  return `${count}-${unit} limit`;
}

type Host = { environmentId: EnvironmentId; hostId: string };
type LimitWindows = {
  primary: typeof Window.Type | null;
  secondary: typeof Window.Type | null;
  tertiary?: typeof Window.Type | undefined;
};

function limitWindows(limit: LimitWindows) {
  return (["primary", "secondary", "tertiary"] as const)
    .flatMap((slot) => {
      const window = limit[slot];
      return window ? [{ ...window, slot }] : [];
    })
    .sort((a, b) => (a.windowDurationMins ?? 0) - (b.windowDurationMins ?? 0));
}

const providerName = (id: string) => (id === "codex" ? "Codex" : id === "claude" ? "Claude" : id);

function usePlanLimitRows({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string | null;
}) {
  const quota = useEnvironmentQuery(
    hostId === null
      ? null
      : openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "workspace.usage" } },
        }),
  );
  return useMemo(() => {
    const limits = decodeLimits(quota.data);
    if (Result.isFailure(limits)) return null;
    return limits.success.limits
      .flatMap((limit) => {
        if (limit.sharedQuotaWith) return [];
        const ring = limitWindows(limit);
        const groupWindows = limit.groups?.flatMap((group, index) =>
          limitWindows(group).map((window) => ({
            ...window,
            key: `${index}:${window.slot}`,
            label: group.name,
          })),
        );
        const windows = groupWindows?.length
          ? groupWindows
          : ring.map((window) => ({
              ...window,
              key: window.slot,
              label: duration(window.windowDurationMins),
            }));
        if (!windows.length) return [];
        return [
          {
            id: limit.id,
            key: `${limit.id}:${limit.accountId ?? ""}`,
            remaining: Math.min(...windows.map(available)),
            windows,
            ring: ring.length ? ring : windows.slice(0, 1),
          },
        ];
      })
      .sort((a, b) => a.remaining - b.remaining);
  }, [quota.data]);
}

type LimitRow = NonNullable<ReturnType<typeof usePlanLimitRows>>[number];
type RememberedPlanLimits = { hostId: string; rows: LimitRow[] };
const rememberedByEnvironment = new Map<EnvironmentId, RememberedPlanLimits>();

function rememberPlanLimits(environmentId: EnvironmentId, last: RememberedPlanLimits) {
  if (!rememberedByEnvironment.has(environmentId) && rememberedByEnvironment.size >= 32) {
    const oldest = rememberedByEnvironment.keys().next().value;
    if (oldest !== undefined) rememberedByEnvironment.delete(oldest);
  }
  rememberedByEnvironment.set(environmentId, last);
}

function PlanLimitRing({ row }: { row: LimitRow }) {
  const p = useBotPalette();
  return (
    <View style={{ height: 34, width: 34, justifyContent: "center", alignItems: "center" }}>
      <Svg width={34} height={34} style={{ position: "absolute" }} pointerEvents="none">
        <G rotation={-90} origin="17, 17">
          {row.ring.map((window, index) => {
            const remaining = available(window);
            const radius = 15.875 - index * 4.5;
            const length = 2 * Math.PI * radius;
            const color = remainingColor(remaining);
            return (
              <G key={window.slot}>
                <Circle
                  cx={17}
                  cy={17}
                  r={radius}
                  stroke={p.muted}
                  strokeOpacity={0.22}
                  strokeWidth={2.25}
                  fill="none"
                />
                {remaining > 0 && (
                  <Circle
                    cx={17}
                    cy={17}
                    r={radius}
                    stroke={color}
                    strokeWidth={2.25}
                    fill="none"
                    strokeDasharray={[length, length]}
                    strokeDashoffset={length * (1 - remaining / 100)}
                  />
                )}
              </G>
            );
          })}
        </G>
      </Svg>
      <ProviderIcon provider={row.id === "claude" ? "claudeAgent" : row.id} size={12} />
    </View>
  );
}

export function BotUsageLimitsButton({
  environmentId,
  hostId,
  offline,
}: {
  environmentId: EnvironmentId;
  hostId: string | null;
  offline: boolean;
}) {
  const gt = useGT();
  const live = usePlanLimitRows({ environmentId, hostId });
  const [last, setLast] = useState(() => rememberedByEnvironment.get(environmentId) ?? null);
  const [showDetails, setShowDetails] = useState(false);
  if (!offline && hostId && live && (last?.hostId !== hostId || last.rows !== live))
    setLast({ hostId, rows: live });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The workspace unmounts when visiting shared Settings; keep only its last host-scoped reading.
  useEffect(() => {
    if (!offline && last && last.hostId === hostId) rememberPlanLimits(environmentId, last);
  }, [environmentId, hostId, last, offline]);
  if (offline && showDetails) setShowDetails(false);
  const remembered = last && (hostId === null || last.hostId === hostId) ? last.rows : [];
  const rows = offline ? remembered : (live ?? remembered);
  if (!rows.length) return null;
  const shown = rows.slice(0, 2);
  const more = rows.length - shown.length;
  return (
    <>
      <BotGlass>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Plan limits, {value}", {
            value: rows.map((row) => `${providerName(row.id)} ${row.remaining}% left`).join(", "),
          })}
          accessibilityState={{ disabled: offline }}
          accessibilityHint={offline ? gt("Last reading before the host disconnected") : undefined}
          disabled={offline}
          onPress={() => setShowDetails(true)}
          className="h-11 min-w-11 flex-row items-center justify-center gap-0.5 px-1 active:opacity-60"
        >
          {shown.map((row) => (
            <PlanLimitRing key={row.key} row={row} />
          ))}
          {more > 0 && <Text className="pr-1 text-xs text-foreground-muted">+{more}</Text>}
        </Pressable>
      </BotGlass>
      {!offline && showDetails && (
        <Sheet title={gt("Plan limits")} onClose={() => setShowDetails(false)}>
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="px-5 py-4"
          >
            <PlanLimitList rows={rows} showTitle={false} />
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}

export function BotUsageLimits(host: Host) {
  const rows = usePlanLimitRows(host);
  return rows?.length ? <PlanLimitList rows={rows} /> : null;
}

function PlanLimitList({ rows, showTitle = true }: { rows: LimitRow[]; showTitle?: boolean }) {
  const gt = useGT();
  const p = useBotPalette();
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the pace marker in step with the wall clock while this view is open.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <SettingsSection
      title={showTitle ? gt("Plan limits") : undefined}
      footer="Current provider limits are independent of the report dates."
    >
      {rows.map((row) => (
        <View key={row.key} className="gap-3 px-4 py-3">
          <View className="flex-row items-center gap-3">
            <PlanLimitRing row={row} />
            <Text className="min-w-0 flex-1 font-t3-semibold">{providerName(row.id)}</Text>
          </View>
          {row.windows.map((window) => {
            const remaining = available(window);
            const pace = remainingAtEvenPace(window, now);
            const reset = window.resetsAt === null ? null : new Date(window.resetsAt * 1_000);
            return (
              <View key={window.key} className="gap-1.5">
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text className="shrink text-sm">{window.label}</Text>
                  <Text
                    className="text-sm tabular-nums"
                    style={{ color: remainingColor(remaining) }}
                  >
                    <T>
                      <Var>{remaining}</Var>% left
                    </T>
                  </Text>
                </View>
                <View
                  className="h-1.5 justify-center"
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={gt("{label}, {remaining}% left{value}", {
                    label: window.label,
                    remaining,
                    value: pace === null ? "" : `, even pace ${Math.round(pace)}%`,
                  })}
                  accessibilityValue={{ min: 0, max: 100, now: remaining }}
                >
                  <View className="h-full overflow-hidden rounded-full">
                    <View
                      className="absolute inset-0"
                      style={{ backgroundColor: p.text, opacity: 0.15 }}
                    />
                    <View
                      className="h-full rounded-full"
                      style={{ width: `${remaining}%`, backgroundColor: remainingColor(remaining) }}
                    />
                  </View>
                  {pace !== null && (
                    <View
                      className="absolute h-2.5 w-0.5 rounded-full"
                      style={{ start: `${pace}%`, marginStart: -1, backgroundColor: p.text }}
                    />
                  )}
                </View>
                {reset && Number.isFinite(reset.getTime()) && (
                  <Text className="text-xs text-foreground-muted">
                    <T>
                      Resets <Var>{formatter.format(reset)}</Var>
                    </T>
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </SettingsSection>
  );
}
