import * as Schema from "effect/Schema";
import { OpenbotEventRoutineInput } from "@t3tools/contracts";
import {
  routineScheduleFromDraft,
  routineScheduleToDraft,
  type RoutineScheduleDraft,
  type RoutineSchedule,
} from "./routine-schedule-draft";
import {
  eventFilterDraft,
  eventFiltersFromDrafts,
  type EventFilterDraft,
} from "./routine-event-filter";
const decodeInput = Schema.decodeUnknownSync(OpenbotEventRoutineInput);
export type Input = typeof OpenbotEventRoutineInput.Type;
export interface Draft {
  input: Input;
  schedule: RoutineScheduleDraft;
  scheduleEdited: boolean;
  filters: EventFilterDraft[];
}
export function draftFor(input: Input): Draft {
  return {
    input,
    schedule:
      input.trigger.kind === "schedule"
        ? routineScheduleToDraft(
            JSON.parse(JSON.stringify(input.trigger.schedule)) as RoutineSchedule,
          )
        : { kind: "daily", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" },
    scheduleEdited: false,
    filters: input.trigger.kind === "webhook" ? input.trigger.filters.map(eventFilterDraft) : [],
  };
}
export function routineDraftInput(draft: Draft): Input {
  const trigger =
    draft.input.trigger.kind === "webhook"
      ? { ...draft.input.trigger, filters: eventFiltersFromDrafts(draft.filters) }
      : draft.scheduleEdited
        ? { kind: "schedule", schedule: routineScheduleFromDraft(draft.schedule) }
        : draft.input.trigger;
  return decodeInput({
    ...draft.input,
    name: draft.input.name.trim(),
    instruction: draft.input.instruction.trim(),
    trigger,
  });
}
