import * as Schema from "effect/Schema";
import { OpenbotRoutineSchedule } from "@t3tools/contracts";
import { nextValidRoutineOccurrence, validateStoredRoutineSchedule } from "./routineSchedule.ts";
export const Routine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  active: Schema.Boolean,
  timezone: Schema.String,
  trigger: Schema.Struct({ schedule: OpenbotRoutineSchedule }),
});
export const Run = Schema.Struct({
  id: Schema.String,
  scheduledFor: Schema.String,
  status: Schema.Literals([
    "queued",
    "running",
    "succeeded",
    "failed",
    "interrupted",
    "cancelled",
    "needs-attention",
  ]),
});
export type CalendarOwner =
  | { kind: "agent"; agentId: string }
  | { kind: "channel"; channelId: string };
export type CalendarRoutine = typeof Routine.Type & { owner: CalendarOwner };
export type CalendarRun = {
  id: string;
  routineId: string;
  at: string;
  status: typeof Run.Type.status | "scheduled";
};
export type Calendar = { routines: CalendarRoutine[]; runs: CalendarRun[] };
export function routineRuns(
  routine: typeof Routine.Type,
  history: readonly (typeof Run.Type)[],
  range: { from: Date; to: Date },
  now: Date,
): CalendarRun[] {
  const runs: CalendarRun[] = [];
  const made = new Set<number>();
  for (const run of history) {
    const at = Date.parse(run.scheduledFor);
    if (!(at >= range.from.getTime() && at < range.to.getTime())) continue;
    made.add(at);
    runs.push({
      id: run.id,
      routineId: routine.id,
      at: new Date(at).toISOString(),
      status: run.status,
    });
  }
  try {
    validateStoredRoutineSchedule(routine.trigger.schedule, routine.timezone);
  } catch {
    return runs;
  }
  const maxRuns = Math.ceil((range.to.getTime() - range.from.getTime()) / (3 * 60_000)) + 1;
  let cursor = new Date(Math.max(range.from.getTime() - 1, now.getTime()));
  for (let count = 0; count < maxRuns; count++) {
    let next: Date;
    try {
      next = nextValidRoutineOccurrence(routine.trigger.schedule, routine.timezone, cursor);
    } catch {
      break;
    }
    if (next.getTime() >= range.to.getTime()) break;
    if (!made.has(next.getTime()))
      runs.push({
        id: `${routine.id}@${next.toISOString()}`,
        routineId: routine.id,
        at: next.toISOString(),
        status: "scheduled",
      });
    cursor = next;
  }
  return runs;
}
export function calendarStatus(status: CalendarRun["status"], active: boolean) {
  if (status === "scheduled") return active ? "active" : "paused";
  if (status === "running" || status === "queued") return "active";
  if (status === "succeeded" || status === "cancelled") return "completed";
  return "failed";
}
