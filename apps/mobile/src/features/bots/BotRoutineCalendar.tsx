import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class RoutineCalendarLoadError extends Schema.TaggedError<RoutineCalendarLoadError>()(
  "RoutineCalendarLoadError",
  {
    cause: Schema.Defect(),
  },
) {}
import { selectionAsync } from "./botFeedback";
import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, OpenbotReadRequest } from "@t3tools/contracts";
import { channelList, workflowAgents } from "@t3tools/client-runtime/openbot/presentation";
import {
  Routine,
  Run,
  calendarStatus,
  routineRuns,
  type CalendarOwner,
  type CalendarRoutine,
  type CalendarRun,
} from "@t3tools/client-runtime/openbot/routineCalendar";
import {
  addCalendarDays,
  calendarDayDate,
  calendarDayOf,
  calendarDays,
  calendarWeekStart,
} from "@t3tools/client-runtime/openbot/routineCalendarDates";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { openbot } from "../../state/openbot";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { EventPanel } from "./BotEvents";
import type { BotRoutineEditTarget } from "./useBotRoutines";

const modes = [
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;
const weekDayLimit = 4;
const upcomingLimit = 6;
const statusIcon = {
  active: "clock",
  paused: "circle.dashed",
  completed: "checkmark.circle",
  failed: "exclamationmark.circle",
} as const;
const decodeList = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown));
const isRoutine = Schema.is(Routine);
const decodeRuns = Schema.decodeUnknownSync(Schema.Array(Run));

type Entry = { run: CalendarRun; routine: CalendarRoutine; owner: string };
type Host = { environmentId: EnvironmentId; hostId: string };

async function loadCalendar(
  read: (request: OpenbotReadRequest) => Promise<unknown>,
  start: string,
  lookAhead: boolean,
): Promise<Entry[]> {
  const [agents, groups] = await Promise.all([
    read({ operation: "agent.list" }).then(workflowAgents),
    read({ operation: "channel.list" }).then(channelList),
  ]);
  if (!groups) throw new Error("Could not read group routines.");
  const owners = [
    ...agents.map((agent) => ({ kind: "agent" as const, agentId: agent.id, name: agent.name })),
    ...groups
      .filter((group) => !group.archived)
      .map((group) => ({
        kind: "channel" as const,
        channelId: group.id,
        name: group.title || group.name,
      })),
  ];
  const routines = (
    await Effect.runPromise(
      Effect.forEach(
        owners,
        (owner) =>
          Effect.tryPromise({
            try: async () => {
              const rows = decodeList(
                await read(
                  owner.kind === "agent"
                    ? { operation: "routine.list", agentId: owner.agentId }
                    : { operation: "channel.routines", channelId: owner.channelId },
                ),
              );
              return rows.filter(isRoutine).map((routine) => ({ ...routine, owner }));
            },
            catch: (cause) => new RoutineCalendarLoadError({ cause }),
          }),
        { concurrency: 8 },
      ),
    )
  ).flat();
  const now = new Date();
  const range = {
    from: new Date(addCalendarDays(start, -1)),
    to: new Date(addCalendarDays(start, lookAhead ? 15 : 8)),
  };
  return (
    await Effect.runPromise(
      Effect.forEach(
        routines,
        (routine) =>
          Effect.tryPromise({
            try: async () => {
              const owner: CalendarOwner = routine.owner;
              const history =
                range.from < now
                  ? decodeRuns(
                      await read(
                        owner.kind === "agent"
                          ? {
                              operation: "routine.runs",
                              agentId: owner.agentId,
                              routineId: routine.id,
                            }
                          : {
                              operation: "channel.routine.runs",
                              channelId: owner.channelId,
                              routineId: routine.id,
                              limit: 100,
                            },
                      ),
                    )
                  : [];
              return routineRuns(routine, history, range, now).map((run) => ({
                run,
                routine,
                owner: routine.owner.name,
              }));
            },
            catch: (cause) => new RoutineCalendarLoadError({ cause }),
          }),
        { concurrency: 8 },
      ),
    )
  )
    .flat()
    .sort((a, b) => a.run.at.localeCompare(b.run.at));
}

export function BotRoutineCalendar({ environmentId, hostId }: Host) {
  const [zone] = useState(() => new Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [today] = useState(() => calendarDayOf(new Date(), zone));
  const [day, setDay] = useState(today);
  const [view, setView] = useState<"week" | "day">("week");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<{ name: string; target: BotRoutineEditTarget } | null>(
    null,
  );
  const [result, setResult] = useState<{
    key: string;
    entries: Entry[];
    loadedAt: number;
    error?: string;
  } | null>(null);
  const start = calendarWeekStart(day, 1);
  const lookAhead = start === calendarWeekStart(today, 1);
  const key = `${environmentId}:${hostId}:${start}:${retry}`;
  const query = useAtomQueryRunner(openbot.readFromHost, { refresh: true, reportFailure: false });
  const load = useEffectEvent(async (anchor: string, upcoming: boolean) =>
    loadCalendar(
      async (request) => {
        const response = await query({ environmentId, input: { hostId, request } });
        if (response._tag === "Failure") throw squashAtomCommandFailure(response);
        return response.value;
      },
      anchor,
      upcoming,
    ),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the selected week from the host; ignore replies for a prior range after navigation.
  useEffect(() => {
    let current = true;
    const loadedAt = Date.now();
    void load(start, lookAhead).then(
      (entries) => {
        if (current) setResult({ key, entries, loadedAt });
      },
      (cause: unknown) => {
        if (current)
          setResult({
            key,
            entries: [],
            loadedAt,
            error: cause instanceof Error ? cause.message : "Could not load routines.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [key, lookAhead, start]);
  const selected = result?.key === key ? result : null;
  const days = calendarDays(start, 7);
  const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
  const dateName = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });
  const shownDays = view === "day" ? [day] : days;
  const entriesByDay = new Map<string, Entry[]>();
  for (const entry of selected?.entries ?? []) {
    const date = calendarDayOf(new Date(entry.run.at), zone);
    const entries = entriesByDay.get(date);
    if (entries) entries.push(entry);
    else entriesByDay.set(date, [entry]);
  }
  const upcoming =
    view === "day" && day === today && selected
      ? selected.entries
          .filter(
            ({ run, routine }) =>
              Date.parse(run.at) >= selected.loadedAt &&
              calendarStatus(run.status, routine.active) === "active",
          )
          .slice(0, upcomingLimit)
      : null;
  const selectDay = (date: string) => {
    void selectionAsync().catch(() => undefined);
    setDay(date);
    setView("day");
  };
  function renderEntry({ run, routine, owner }: Entry, includeDate = false) {
    const status = calendarStatus(run.status, routine.active);
    const at = new Date(run.at);
    const when = includeDate
      ? `${dateName.format(calendarDayDate(calendarDayOf(at, zone)))} at ${time.format(at)}`
      : time.format(at);
    const ownerId =
      routine.owner.kind === "agent" ? routine.owner.agentId : routine.owner.channelId;
    return (
      <SettingsRow
        key={`${routine.owner.kind}:${ownerId}:${routine.id}:${run.id}`}
        icon={statusIcon[status]}
        label={routine.name}
        value={`${owner} · ${when} · ${status}`}
        valuePosition="below"
        onPress={() =>
          setEditing({
            name: routine.name,
            target: { owner: { kind: routine.owner.kind, id: ownerId }, routineId: routine.id },
          })
        }
      />
    );
  }

  return (
    <View className="gap-4">
      <SegmentedControl options={modes} selected={view} onSelect={setView} />
      <View className="flex-row items-center justify-between gap-2">
        <Button
          label="Previous"
          tone="secondary"
          onPress={() => setDay(addCalendarDays(day, view === "week" ? -7 : -1))}
        />
        <Button label="Today" tone="secondary" onPress={() => setDay(today)} />
        <Button
          label="Next"
          tone="secondary"
          onPress={() => setDay(addCalendarDays(day, view === "week" ? 7 : 1))}
        />
      </View>
      <View className="flex-row gap-1">
        {days.map((date) => {
          const value = calendarDayDate(date);
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: date === day }}
              accessibilityLabel={`${dayName.format(value)}, ${dateName.format(value)}`}
              onPress={() => selectDay(date)}
              className={`min-h-12 flex-1 items-center justify-center gap-0.5 rounded-xl ${date === day ? "bg-card" : "bg-subtle"}`}
            >
              <Text className="text-xs text-foreground-muted">{dayName.format(value)}</Text>
              <Text className="font-t3-semibold">{value.getUTCDate()}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected === null ? (
        <Text accessibilityRole="status">Loading routines…</Text>
      ) : selected.error ? (
        <View className="gap-2">
          <Text accessibilityRole="alert">{selected.error}</Text>
          <Button label="Retry" onPress={() => setRetry((count) => count + 1)} />
        </View>
      ) : (
        <>
          {shownDays.map((date) => {
            const entries = entriesByDay.get(date) ?? [];
            const shown = view === "week" ? entries.slice(0, weekDayLimit) : entries;
            const hidden = entries.length - shown.length;
            return (
              <SettingsSection
                key={date}
                title={
                  date === today
                    ? "Today"
                    : `${dayName.format(calendarDayDate(date))}, ${dateName.format(calendarDayDate(date))}`
                }
              >
                {shown.length > 0 ? (
                  shown.map((entry) => renderEntry(entry))
                ) : (
                  <Text className="px-4 py-3 text-foreground-muted">No scheduled runs.</Text>
                )}
                {hidden > 0 && (
                  <SettingsRow
                    icon="calendar.badge.clock"
                    label={`${hidden} more`}
                    onPress={() => selectDay(date)}
                  />
                )}
              </SettingsSection>
            );
          })}
          {upcoming && (
            <SettingsSection title="Upcoming">
              {upcoming.length > 0 ? (
                upcoming.map((entry) => renderEntry(entry, true))
              ) : (
                <Text className="px-4 py-3 text-foreground-muted">No upcoming runs.</Text>
              )}
            </SettingsSection>
          )}
          <Text className="px-1 text-xs text-foreground-muted">
            Times in {zone.replaceAll("_", " ")}
          </Text>
        </>
      )}
      {editing && (
        <Sheet
          title={editing.name}
          onClose={() => {
            setEditing(null);
            setRetry((count) => count + 1);
          }}
        >
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 py-4"
          >
            <EventPanel environmentId={environmentId} hostId={hostId} initial={editing.target} />
          </ScreenScrollView>
        </Sheet>
      )}
    </View>
  );
}
