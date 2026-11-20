import { describe, expect, it } from "vite-plus/test";
import { calendarDayOf, calendarDays, calendarWeekStart } from "./calendarDates";
import { routineRuns, calendarStatus, type CalendarRoutine } from "./calendarModel";

const routine: CalendarRoutine = {
  id: "morning",
  name: "Morning brief",
  active: false,
  timezone: "America/Chicago",
  owner: { kind: "agent", agentId: "assistant" },
  trigger: { schedule: { kind: "daily", time: "09:00" } },
};
describe("OpenBot calendar source projection", () => {
  it("keeps paused plans, replaces a matching plan with its actual result, and excludes history outside the requested range", () => {
    const runs = routineRuns(
      routine,
      [
        { id: "actual", scheduledFor: "2026-11-09T15:00:00Z", status: "succeeded" },
        { id: "outside", scheduledFor: "2026-11-08T15:00:00Z", status: "failed" },
      ],
      { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2026-11-11T00:00:00Z") },
      new Date("2026-11-09T14:00:00Z"),
    );
    expect(runs.map((run) => [run.id, run.at, calendarStatus(run.status, routine.active)])).toEqual(
      [
        ["actual", "2026-11-09T15:00:00.000Z", "completed"],
        ["morning@2026-11-10T15:00:00.000Z", "2026-11-10T15:00:00.000Z", "paused"],
      ],
    );
  });
  it("places local days correctly across a daylight-saving change and expands local schedules at their wall-clock time", () => {
    const runs = routineRuns(
      routine,
      [],
      { from: new Date("2026-10-31T00:00:00Z"), to: new Date("2026-11-03T00:00:00Z") },
      new Date("2026-10-30T00:00:00Z"),
    );
    expect(runs.map((run) => run.at)).toEqual([
      "2026-10-31T14:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
    expect(calendarDayOf(new Date("2026-11-02T02:00:00Z"), "America/Chicago")).toBe("2026-11-01");
    expect(calendarDays(calendarWeekStart("2026-11-01", 1), 7)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
  it("keeps actual history when a persisted timezone no longer validates", () => {
    expect(
      routineRuns(
        { ...routine, timezone: "not/a/zone" },
        [{ id: "failed", scheduledFor: "2026-11-09T15:00:00Z", status: "failed" }],
        { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2026-11-10T00:00:00Z") },
        new Date("2026-11-09T14:00:00Z"),
      ),
    ).toEqual([
      { id: "failed", routineId: "morning", at: "2026-11-09T15:00:00.000Z", status: "failed" },
    ]);
  });
});
