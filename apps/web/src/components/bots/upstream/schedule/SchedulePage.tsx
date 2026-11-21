/* oxlint-disable shadcn/no-unknown-classes -- RoutineCalendar source selectors are imported below. */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { Effect } from "effect";

class ScheduleLoadError extends Schema.TaggedError<ScheduleLoadError>()("ScheduleLoadError", {
  cause: Schema.Defect(),
}) {}
import type { EnvironmentId, OpenbotReadRequest } from "@t3tools/contracts";
import { channelList, workflowAgents } from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ArrowLeft, ChevronLeft, ChevronRight, Check, CirclePause, X } from "lucide-react";
import { openbot } from "../../../../state/openbot";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { OpenbotSlidingTabs } from "../OpenbotSlidingTabs";
import { BotAvatar } from "../../avatar/BotAvatar";
import {
  Routine,
  Run,
  routineRuns,
  calendarStatus,
  type Calendar,
  type CalendarRoutine,
} from "./calendarModel";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDayDate,
  calendarDayOf,
  calendarDays,
  calendarMonthStart,
  calendarWeekStart,
  clockChangeDay,
} from "./calendarDates";
import { ScheduleEmptyBoard } from "./ScheduleEmptyBoard";
import "./routine-calendar.css";
import "./schedule-adapter.css";
import { m } from "../../../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react";

type Agent = {
  id: string;
  name: string;
  avatarSeed?: string | undefined;
  avatarHue?: number | null | undefined;
};
type View = "day" | "week" | "month";
const decodeRoutines = Schema.decodeUnknownSync(Schema.Array(Routine));
const decodeRuns = Schema.decodeUnknownSync(Schema.Array(Run));
const VIEWS = [
  { value: "day", label: m(msg("Day")) },
  { value: "week", label: m(msg("Week")) },
  { value: "month", label: m(msg("Month")) },
] as const;
function daysFor(anchor: string, view: View) {
  if (view === "day") return [anchor];
  if (view === "week") return calendarDays(calendarWeekStart(anchor, 1), 7);
  const next = addCalendarMonths(anchor, 1);
  const days: string[] = [];
  for (
    let week = calendarWeekStart(calendarMonthStart(anchor), 1);
    week < next;
    week = addCalendarDays(week, 7)
  )
    days.push(...calendarDays(week, 7));
  return days;
}
export type SchedulePageProps = {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  agents: readonly Agent[];
  onBack?: () => void;
  onOpenAgent: (id: string) => void;
  onOpenRoutine: (routine: CalendarRoutine) => void;
  onCreateRoutine?: (agentId: string) => void;
};
export function SchedulePage(props: SchedulePageProps) {
  return <ScheduleBody key={`${props.environmentId}:${props.hostId}`} {...props} />;
}
function ScheduleBody(props: SchedulePageProps) {
  const gt = useGT();
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  const today = calendarDayOf(now, zone);
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [members, setMembers] = useState<Map<string, readonly string[]>>(new Map());
  const generation = useRef(0);
  const changes = useAtomValue(openbot.changes({ environmentId: props.environmentId, input: {} }));
  const change = AsyncResult.getOrElse(changes, () => null);
  const revision =
    change &&
    (change.hostId === null || change.hostId === props.hostId) &&
    ["all", "agents", "routines", "conversation"].includes(change.resource)
      ? changes
      : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const read = useStableCallback(async (request: OpenbotReadRequest) => {
    const result = await query({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request },
    });
    if (result._tag === "Failure") throw new Error(String(squashAtomCommandFailure(result)));
    return result.value;
  });
  const load = useStableCallback(
    async (currentAnchor: string, currentView: View, background = false) => {
      const request = ++generation.current;
      if (!background) setPhase("loading");
      setError("");
      const settled = await settlePromise(async () => {
        const visible = daysFor(currentAnchor, currentView);
        const range = {
          from: new Date(`${addCalendarDays(visible[0] ?? currentAnchor, -1)}T00:00:00Z`),
          to: new Date(`${addCalendarDays(visible.at(-1) ?? currentAnchor, 2)}T00:00:00Z`),
        };
        const agentRows = workflowAgents(await read({ operation: "agent.list" }));
        const channels = channelList(await read({ operation: "channel.list" }));
        if (!channels) throw new Error("The host returned an unsupported channel list.");
        const owners = [
          ...agentRows.map((agent) => ({ kind: "agent" as const, agentId: agent.id })),
          ...channels
            .filter((channel) => !channel.archived)
            .map((channel) => ({ kind: "channel" as const, channelId: channel.id })),
        ];
        const routines = (
          await Effect.runPromise(
            Effect.forEach(
              owners,
              (owner) =>
                Effect.tryPromise({
                  try: async () => {
                    const rows = decodeRoutines(
                      await read(
                        owner.kind === "agent"
                          ? { operation: "routine.list", agentId: owner.agentId }
                          : { operation: "channel.routines", channelId: owner.channelId },
                      ),
                    );
                    return rows.map((routine) => ({ ...routine, owner }));
                  },
                  catch: (cause) => new ScheduleLoadError({ cause }),
                }),
              { concurrency: 8 },
            ),
          )
        ).flat();
        const clock = new Date();
        const runs = (
          await Effect.runPromise(
            Effect.forEach(
              routines,
              (routine) =>
                Effect.tryPromise({
                  try: async () => {
                    const history =
                      range.from < clock
                        ? decodeRuns(
                            await read(
                              routine.owner.kind === "agent"
                                ? {
                                    operation: "routine.runs",
                                    agentId: routine.owner.agentId,
                                    routineId: routine.id,
                                  }
                                : {
                                    operation: "channel.routine.runs",
                                    channelId: routine.owner.channelId,
                                    routineId: routine.id,
                                    limit: 100,
                                  },
                            ),
                          )
                        : [];
                    return routineRuns(routine, history, range, clock);
                  },
                  catch: (cause) => new ScheduleLoadError({ cause }),
                }),
              { concurrency: 8 },
            ),
          )
        ).flat();
        if (request !== generation.current) return;
        setMembers(
          new Map(
            channels.map((channel) => [
              channel.id,
              channel.members.map((member) => member.agentId),
            ]),
          ),
        );
        setCalendar({ routines, runs });
        setNow(clock);
        setPhase("ready");
      });
      if (
        settled._tag === "Failure" &&
        request === generation.current &&
        !(background && calendar)
      ) {
        const cause = squashAtomCommandFailure(settled);
        setError(cause instanceof Error ? cause.message : gt("Could not load the schedule."));
        setPhase("error");
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the host calendar on mount and release outstanding asynchronous loads on navigation.
  useEffect(() => {
    void load(anchor, view);
    return () => {
      generation.current++;
    };
  }, [load, anchor, view]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the calendar projection when the host subscription reports a schedule-affecting change.
  useEffect(() => {
    if (revision) void load(anchor, view, true);
  }, [revision, load, anchor, view]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source calendar clock advances every minute; it never fabricates a completed run.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const days = daysFor(anchor, view);
  const move = (next: string, nextView: View = view) => {
    setAnchor(next);
    setView(nextView);
  };
  const dayText = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
      calendarDayDate(day),
    );
  const time = (at: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(at));
  const entries = (calendar?.runs ?? [])
    .flatMap((run) => {
      const routine = calendar?.routines.find((item) => item.id === run.routineId);
      if (!routine) return [];
      const ids =
        routine.owner.kind === "agent"
          ? [routine.owner.agentId]
          : (members.get(routine.owner.channelId) ?? []);
      return [
        {
          run,
          routine,
          status: calendarStatus(run.status, routine.active),
          agents: props.agents.filter((agent) => ids.includes(agent.id)),
        },
      ];
    })
    .sort((a, b) => Date.parse(a.run.at) - Date.parse(b.run.at));
  const upcoming = entries
    .filter((entry) => entry.status === "active" && Date.parse(entry.run.at) >= now.getTime())
    .slice(0, 6);
  const empty = phase === "ready" && calendar?.routines.length === 0;
  const changeDay = clockChangeDay(days, zone);
  const rangeLabel =
    view === "month"
      ? dayText(anchor, { month: "long", year: "numeric" })
      : view === "day"
        ? dayText(anchor, { weekday: "long", month: "long", day: "numeric" })
        : `${dayText(days[0] ?? anchor, { month: "short", day: "numeric" })} – ${dayText(days.at(-1) ?? anchor, { month: "short", day: "numeric", year: "numeric" })}`;
  const mark = (status: string) => (
    <span className="routine-planner-status" data-status={status} aria-hidden="true">
      {status === "completed" ? (
        <Check size={14} />
      ) : status === "failed" ? (
        <X size={14} />
      ) : status === "paused" ? (
        <CirclePause size={14} />
      ) : (
        <span className="routine-planner-status-dot" />
      )}
    </span>
  );
  const entryRow = (entry: (typeof entries)[number]) => (
    <li key={entry.run.id} className="routine-planner-entry" data-status={entry.status}>
      <button
        className="ui-button routine-planner-entry-main"
        onClick={() => props.onOpenRoutine(entry.routine)}
      >
        {mark(entry.status)}
        <span className="routine-planner-entry-text">
          <span className="routine-planner-entry-name">{entry.routine.name}</span>
          <span className="routine-planner-entry-meta">
            {dayText(calendarDayOf(new Date(entry.run.at), zone), {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            , {time(entry.run.at)} · {entry.status}
          </span>
        </span>
      </button>
      <span className="routine-planner-entry-agents">
        {entry.agents.map((agent) => (
          <button
            key={agent.id}
            className="ui-icon-button routine-planner-agent"
            aria-label={gt("Open {name}", { name: agent.name })}
            onClick={() => props.onOpenAgent(agent.id)}
          >
            <BotAvatar
              seed={agent.avatarSeed ?? agent.id}
              hue={agent.avatarHue ?? null}
              size={20}
            />
          </button>
        ))}
      </span>
    </li>
  );
  return (
    <section className="routine-planner" data-view={view} aria-label={gt("Schedule")}>
      <header className="routine-planner-header">
        <div className="routine-planner-title">
          <div className="routine-planner-identity">
            {props.onBack && (
              <button className="ui-icon-button" aria-label={gt("Back")} onClick={props.onBack}>
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 ref={heading} tabIndex={-1}>
              <T>Schedule</T>{" "}
              {props.hostName && (
                <>
                  <span>/</span> <span>{props.hostName}</span>
                </>
              )}
            </h2>
          </div>
          <p>
            <T>
              Times in <Var>{zone.replaceAll("_", " ")}</Var>
            </T>
          </p>
        </div>
        <button className="ui-button" onClick={() => void load(anchor, view)}>
          <T>Refresh</T>
        </button>
        {!empty && (
          <div className="routine-planner-toolbar">
            <div className="routine-planner-nav">
              <button
                className="ui-icon-button"
                aria-label={gt("Previous {view}", { view })}
                onClick={() =>
                  move(
                    view === "month"
                      ? addCalendarMonths(anchor, -1)
                      : addCalendarDays(anchor, view === "week" ? -7 : -1),
                  )
                }
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="ui-button"
                disabled={
                  view === "month"
                    ? calendarMonthStart(anchor) === calendarMonthStart(today)
                    : days.includes(today)
                }
                onClick={() => {
                  move(today);
                  heading.current?.focus();
                }}
              >
                <T>Today</T>
              </button>
              <button
                className="ui-icon-button"
                aria-label={gt("Next {view}", { view })}
                onClick={() =>
                  move(
                    view === "month"
                      ? addCalendarMonths(anchor, 1)
                      : addCalendarDays(anchor, view === "week" ? 7 : 1),
                  )
                }
              >
                <ChevronRight size={16} />
              </button>
              <p className="routine-planner-range" aria-live="polite">
                {rangeLabel}
              </p>
            </div>
            <OpenbotSlidingTabs
              value={view}
              onChange={setView}
              items={VIEWS}
              label={gt("Calendar view")}
            />
          </div>
        )}
        {!empty && changeDay && (
          <p className="routine-planner-clock-change">
            <T>
              Clocks change on<Var> </Var>
              <Var>{dayText(changeDay, { weekday: "long", month: "long", day: "numeric" })}</Var>.
            </T>
          </p>
        )}
      </header>
      {phase === "error" ? (
        <div className="routine-planner-error" role="alert">
          <p>{error}</p>
          <button className="ui-button" onClick={() => void load(anchor, view)}>
            <T>Retry</T>
          </button>
        </div>
      ) : empty ? (
        <div className="routine-planner-empty">
          <ScheduleEmptyBoard days={daysFor(today, "month")} today={today} agents={props.agents} />
          <div className="routine-planner-empty-pitch">
            <h3 className="routine-planner-empty-title">
              <span className="routine-planner-empty-lead">
                <T>Set it once.</T>
              </span>
              <span>
                <T>Wake up to it</T>{" "}
                <span className="routine-planner-hand routine-planner-empty-done">done</span>.
              </span>
            </h3>
            <p className="routine-planner-empty-lines">
              <span>
                <T>Your agents keep their own schedule.</T>
              </span>
              <span>
                <T>Each run leaves a note.</T>
              </span>
            </p>
            {props.onCreateRoutine && (
              <label>
                <T>Create routine for</T>{" "}
                <select
                  aria-label={gt("Create routine for agent")}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) props.onCreateRoutine?.(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    <T>Choose agent</T>
                  </option>
                  {props.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      ) : (
        <div className="routine-planner-body" aria-busy={phase === "loading"}>
          {view === "day" ? (
            <div className="routine-planner-day-view">
              <ul className="routine-planner-entries">
                {entries
                  .filter((entry) => calendarDayOf(new Date(entry.run.at), zone) === anchor)
                  .map(entryRow)}
              </ul>
              {!entries.some((entry) => calendarDayOf(new Date(entry.run.at), zone) === anchor) && (
                <p className="routine-planner-note">
                  <T>No runs on this day.</T>
                </p>
              )}
            </div>
          ) : (
            <div className="routine-planner-grid">
              <div className="routine-planner-weekdays" aria-hidden="true">
                {days.slice(0, 7).map((day) => (
                  <span key={day}>{dayText(day, { weekday: "short" })}</span>
                ))}
              </div>
              <ol className="routine-planner-week">
                {days.map((day) => {
                  const rows = entries.filter(
                    (entry) => calendarDayOf(new Date(entry.run.at), zone) === day,
                  );
                  const limit = view === "month" ? 3 : 4;
                  return (
                    <li
                      key={day}
                      className="routine-planner-day"
                      aria-current={day === today ? "date" : undefined}
                      data-past={day < today ? "" : undefined}
                      data-outside={
                        view === "month" && calendarMonthStart(day) !== calendarMonthStart(anchor)
                          ? ""
                          : undefined
                      }
                    >
                      <h3 className="routine-planner-day-heading">
                        <button
                          className="ui-button routine-planner-day-button"
                          aria-label={gt("Open {day}", { day })}
                          onClick={() => {
                            move(day, "day");
                            heading.current?.focus();
                          }}
                        >
                          <span>{dayText(day, { weekday: "short" })}</span>
                          <strong>{Number(day.slice(-2))}</strong>
                        </button>
                      </h3>
                      {phase === "loading" ? (
                        <span className="routine-planner-skeleton-run" />
                      ) : (
                        <ul className="routine-planner-runs">
                          {rows.slice(0, limit).map((entry) => (
                            <li key={entry.run.id}>
                              <button
                                className="ui-button routine-planner-run"
                                data-status={entry.status}
                                aria-label={`${entry.routine.name}, ${time(entry.run.at)}, ${entry.status}`}
                                onClick={() => props.onOpenRoutine(entry.routine)}
                              >
                                {mark(entry.status)}
                                <span className="routine-planner-run-time">
                                  {time(entry.run.at)}
                                </span>
                                <span className="routine-planner-run-name">
                                  {entry.routine.name}
                                </span>
                                <span className="routine-planner-avatars">
                                  {entry.agents.slice(0, 2).map((agent) => (
                                    <BotAvatar
                                      key={agent.id}
                                      seed={agent.avatarSeed ?? agent.id}
                                      size={18}
                                    />
                                  ))}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {rows.length > limit && (
                        <button
                          className="ui-button routine-planner-more"
                          onClick={() => move(day, "day")}
                        >
                          +{rows.length - limit} more
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <aside className="routine-planner-upcoming">
            <h3>
              <T>Upcoming</T>
            </h3>
            {upcoming.length ? (
              <ul className="routine-planner-entries">{upcoming.map(entryRow)}</ul>
            ) : (
              <p className="routine-planner-note">
                <T>No upcoming runs in this range.</T>
              </p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
