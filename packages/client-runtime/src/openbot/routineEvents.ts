import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotEventRoutineInput,
  OpenbotRoutineFlowCanvas,
  OpenbotRoutineTriggerInput,
  type OpenbotEventAdminRequest,
} from "@t3tools/contracts";

const decodeInput = Schema.decodeUnknownResult(OpenbotEventRoutineInput);
const decodeCanvas = Schema.decodeUnknownResult(OpenbotRoutineFlowCanvas);
const decodeTrigger = Schema.decodeUnknownResult(OpenbotRoutineTriggerInput);
export const EVENT_ROUTINE_TEMPLATE = JSON.stringify(
  {
    name: "",
    instruction: "",
    active: true,
    timezone: "UTC",
    trigger: { kind: "webhook", eventType: null, filters: [] },
    limitPolicy: "wait",
    missedPolicy: "skip",
  },
  null,
  2,
);
export const EVENT_SCHEDULE_TEMPLATE = JSON.stringify(
  {
    name: "",
    instruction: "",
    active: true,
    timezone: "UTC",
    trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
    limitPolicy: "wait",
    missedPolicy: "run-once",
  },
  null,
  2,
);
export function eventRoutineRequest(
  text: string,
  owner: { kind: "agent" | "channel"; id: string },
): Extract<OpenbotEventAdminRequest, { operation: "events.save" }> | null {
  try {
    const result = decodeInput({ ...JSON.parse(text), owner }, { onExcessProperty: "error" });
    return Result.isSuccess(result) ? { operation: "events.save", ...result.success } : null;
  } catch {
    return null;
  }
}
export function eventRoutineDraft(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const {
    owner: _owner,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = value as Record<string, unknown>;
  if (input.trigger && typeof input.trigger === "object") {
    const trigger = Object.fromEntries(
      Object.entries(input.trigger).filter(([key]) => key !== "url"),
    );
    input.trigger = trigger;
  }
  const draft = JSON.stringify(input, null, 2);
  return eventRoutineRequest(draft, { kind: "agent", id: "validation" }) ? draft : null;
}
export function routineFlowCanvas(value: unknown) {
  const result = decodeCanvas(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function routineRows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    : [];
}
export function routineTriggerDescription(value: unknown) {
  const result = decodeTrigger(value);
  if (!Result.isSuccess(result)) return "Unsupported trigger";
  return result.success.kind === "webhook"
    ? `Webhook: ${result.success.eventType ?? "any event"}`
    : `Schedule: ${JSON.stringify(result.success.schedule)}`;
}
