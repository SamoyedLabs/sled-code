import { describe, it, expect } from "vite-plus/test";
import { draftFor, routineDraftInput, type Input } from "./routine-editor-model";
import { routineScheduleFromDraft, routineScheduleToDraft } from "./routine-schedule-draft";
import { eventFilterDraft, eventFiltersFromDrafts } from "./routine-event-filter";
describe("source routine editor", () => {
  it("preserves an anchored interval schedule on unrelated edits", () => {
    const input: Input = {
      owner: { kind: "agent", id: "agent-a" },
      id: "routine-a",
      name: "Original",
      instruction: "Report",
      active: true,
      timezone: "America/Chicago",
      trigger: {
        kind: "schedule",
        schedule: {
          kind: "interval",
          amount: 7,
          unit: "hours",
          anchorAt: "2026-11-09T13:27:00.000Z",
        },
      },
      missedPolicy: "run-once",
    };
    const draft = draftFor(input);
    expect(routineDraftInput({ ...draft, input: { ...input, name: "Renamed" } }).trigger).toEqual(
      input.trigger,
    );
  });
  it("keeps a yearly leap day and hourly minute when converting source drafts", () => {
    const yearly = { kind: "yearly", month: 2, day: 29, time: "07:30" } as const;
    expect(routineScheduleToDraft(routineScheduleFromDraft(yearly))).toEqual(yearly);
    const once = { kind: "once", date: "2028-02-29", time: "09:30" } as const;
    const input: Input = {
      owner: { kind: "agent", id: "a" },
      name: "Once",
      instruction: "Ready",
      active: true,
      timezone: "UTC",
      trigger: { kind: "schedule", schedule: once },
      missedPolicy: "skip",
    };
    const draft = draftFor(input);
    expect(routineDraftInput({ ...draft, scheduleEdited: true }).trigger).toEqual(input.trigger);
    expect(
      routineScheduleFromDraft(routineScheduleToDraft({ kind: "hourly", minute: 35 })),
    ).toEqual({ kind: "hourly", minute: 35 });
  });
  it("keeps filter strings that look like scalars distinct from real scalars", () => {
    const filters = [
      { pointer: "/string", value: "true" },
      { pointer: "/boolean", value: true },
      { pointer: "/number", value: 42 },
      { pointer: "/null", value: null },
    ];
    expect(eventFiltersFromDrafts(filters.map(eventFilterDraft))).toEqual(filters);
  });
});
