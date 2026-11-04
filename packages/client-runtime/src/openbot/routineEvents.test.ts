import { describe, expect, it } from "@effect/vitest";
import { eventRoutineDraft, eventRoutineRequest, EVENT_ROUTINE_TEMPLATE } from "./routineEvents.ts";
describe("routine configuration editing", () => {
  it("keeps recovery and identifiers but refuses unknown fields instead of silently deleting future configuration", () => {
    const owner = { kind: "channel" as const, id: "c" };
    const draft = {
      ...JSON.parse(EVENT_ROUTINE_TEMPLATE),
      id: "r",
      missedPolicy: "run-once",
      trigger: { kind: "webhook", eventType: null, filters: [], url: "https://private.test/hook" },
    };
    const editable = eventRoutineDraft({ ...draft, owner, createdAt: "now", updatedAt: "now" });
    expect(editable).not.toContain("private.test");
    expect(eventRoutineRequest(editable!, owner)).toMatchObject({
      id: "r",
      owner,
      missedPolicy: "run-once",
    });
    expect(eventRoutineDraft({ ...draft, future: true })).toBeNull();
    expect(
      eventRoutineRequest(
        JSON.stringify({
          ...draft,
          trigger: {
            kind: "webhook",
            eventType: null,
            filters: [{ pointer: "/bad~escape", value: true }],
          },
        }),
        owner,
      ),
    ).toBeNull();
  });
});
