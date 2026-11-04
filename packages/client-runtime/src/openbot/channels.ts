import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotChannelMemory,
  OpenbotChannelRoutine,
  OpenbotChannelRoutineRun,
  OpenbotChannelPage,
  OpenbotChannelSummary,
  OpenbotChannelAdminRequest,
  type OpenbotChannel,
  type OpenbotChannelDraft,
  type OpenbotChannelMessage,
  type OpenbotChannelTask,
} from "@t3tools/contracts";

const decodeList = Schema.decodeUnknownResult(Schema.Array(OpenbotChannelSummary));
const decodePage = Schema.decodeUnknownResult(OpenbotChannelPage);
const decodeAdmin = Schema.decodeUnknownResult(OpenbotChannelAdminRequest);
export function channelList(value: unknown) {
  const result = decodeList(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function channelPage(value: unknown) {
  const result = decodePage(value);
  return Result.isSuccess(result) ? result.success : null;
}
type WithoutOperationId<Request> = Request extends unknown ? Omit<Request, "operationId"> : never;
export type ChannelActionInput = WithoutOperationId<OpenbotChannelAdminRequest>;
export function channelAdminRequest(
  input: ChannelActionInput,
  operationId: string,
): OpenbotChannelAdminRequest | null {
  const result = decodeAdmin({ ...input, operationId });
  return Result.isSuccess(result) ? result.success : null;
}
export type ChannelEdit = {
  readonly channelId: string;
  readonly baseRevision: number;
  readonly update: boolean;
  readonly base: OpenbotChannelDraft;
  readonly value: OpenbotChannelDraft;
};
function channelValue(channel: OpenbotChannel): OpenbotChannelDraft {
  return {
    name: channel.name,
    title: channel.title,
    instructions: channel.instructions,
    members: channel.members,
    leadAgentId: channel.leadAgentId,
  };
}
export function channelEditDraft(channel: OpenbotChannel): ChannelEdit {
  const value = channelValue(channel);
  return {
    channelId: channel.id,
    baseRevision: channel.revision,
    update: true,
    base: value,
    value,
  };
}
export function channelNewDraft(channelId: string): ChannelEdit {
  const value = { name: "", title: "", instructions: "", members: [], leadAgentId: null };
  return { channelId, baseRevision: 0, update: false, base: value, value };
}
export function channelSetVisibleMembers(
  edit: ChannelEdit,
  visibleIds: ReadonlySet<string>,
  selectedIds: readonly string[],
): ChannelEdit {
  const selected = new Set(selectedIds.filter((id) => visibleIds.has(id)));
  const retained = edit.value.members.filter(
    (member) => !visibleIds.has(member.agentId) || selected.has(member.agentId),
  );
  const retainedIds = new Set(retained.map((member) => member.agentId));
  const members = [
    ...retained,
    ...[...selected].filter((id) => !retainedIds.has(id)).map((agentId) => ({ agentId })),
  ];
  const leadAgentId = members.some((member) => member.agentId === edit.value.leadAgentId)
    ? edit.value.leadAgentId
    : null;
  return { ...edit, value: { ...edit.value, members, leadAgentId } };
}
export function channelDraftConflict(edit: ChannelEdit, current: OpenbotChannel | null) {
  return (
    edit.update &&
    (!current ||
      current.id !== edit.channelId ||
      JSON.stringify(channelValue(current)) !== JSON.stringify(edit.base))
  );
}
export function channelSaveRequest(
  edit: ChannelEdit,
  operationId: string,
  current: OpenbotChannel | null,
): Extract<OpenbotChannelAdminRequest, { operation: "channel.save" }> | null {
  if (channelDraftConflict(edit, current)) return null;
  const request = channelAdminRequest(
    {
      operation: "channel.save",
      channelId: edit.channelId,
      update: edit.update,
      draft: edit.value,
    },
    operationId,
  );
  return request?.operation === "channel.save" ? request : null;
}
export function channelMessages(
  channelId: string,
  pages: readonly OpenbotChannelPage[],
): readonly OpenbotChannelMessage[] {
  const messages = new Map<string, OpenbotChannelMessage>();
  for (const page of pages) {
    if (page.channel.id !== channelId) continue;
    for (const message of page.messages)
      if (message.channelId === channelId) messages.set(message.id, message);
  }
  return [...messages.values()].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
}
export function channelTaskActions(
  state: OpenbotChannelTask["state"],
  archived: boolean,
): readonly ("stop" | "resume" | "reassign" | "cancel")[] {
  if (archived || state === "completed" || state === "cancelled") return [];
  return state === "paused" || state === "failed"
    ? ["resume", "reassign", "cancel"]
    : ["stop", "reassign"];
}

export function channelExtras(
  value: unknown,
  kind: "memories",
): readonly import("@t3tools/contracts").OpenbotChannelMemory[] | null;
export function channelExtras(
  value: unknown,
  kind: "routines",
): readonly import("@t3tools/contracts").OpenbotChannelRoutine[] | null;
export function channelExtras(
  value: unknown,
  kind: "runs",
): readonly import("@t3tools/contracts").OpenbotChannelRoutineRun[] | null;
export function channelExtras(value: unknown, kind: "memories" | "routines" | "runs") {
  const schemas = {
    memories: Schema.Array(OpenbotChannelMemory),
    routines: Schema.Array(OpenbotChannelRoutine),
    runs: Schema.Array(OpenbotChannelRoutineRun),
  };
  const schema: Schema.Codec<unknown> = schemas[kind];
  const result = Schema.decodeUnknownResult(schema)(value);
  return Result.isSuccess(result) ? result.success : null;
}

export type ChannelSchedule = OpenbotChannelRoutine["trigger"]["schedule"];
export type ChannelScheduleDraft = {
  kind: ChannelSchedule["kind"];
  time: string;
  minute: string;
  weekday: string;
  day: string;
  amount: string;
  unit: "minutes" | "hours" | "days";
  anchorAt: string;
  expression: string;
  months: string;
  dayKind: "every-day" | "days-of-week" | "days-of-month";
  days: string;
  timeKind: "at-time" | "every";
};
export function channelScheduleDraft(schedule?: ChannelSchedule): ChannelScheduleDraft {
  const draft: ChannelScheduleDraft = {
    kind: schedule?.kind ?? "daily",
    time: "09:00",
    minute: "0",
    weekday: "1",
    day: "1",
    amount: "1",
    unit: "hours",
    anchorAt: "",
    expression: "",
    months: "1,2,3,4,5,6,7,8,9,10,11,12",
    dayKind: "every-day",
    days: "1",
    timeKind: "at-time",
  };
  if (!schedule) return draft;
  if ("time" in schedule && typeof schedule.time === "string") draft.time = schedule.time;
  if (schedule.kind === "hourly") draft.minute = String(schedule.minute);
  if (schedule.kind === "weekly") draft.weekday = String(schedule.weekday);
  if (schedule.kind === "monthly") draft.day = String(schedule.day);
  if (schedule.kind === "custom") draft.expression = schedule.expression;
  if (schedule.kind === "interval")
    Object.assign(draft, {
      amount: String(schedule.amount),
      unit: schedule.unit,
      anchorAt: schedule.anchorAt,
    });
  if (schedule.kind === "advanced") {
    draft.months = schedule.months.join(",");
    draft.dayKind = schedule.days.kind;
    if (schedule.days.kind !== "every-day") draft.days = schedule.days.days.join(",");
    draft.timeKind = schedule.time.kind;
    if (schedule.time.kind === "at-time") draft.time = schedule.time.time;
    else Object.assign(draft, { amount: String(schedule.time.amount), unit: schedule.time.unit });
  }
  return draft;
}
const decodeSchedule = Schema.decodeUnknownResult(
  OpenbotChannelRoutine.fields.trigger.fields.schedule,
);
export function channelScheduleValue(draft: ChannelScheduleDraft): ChannelSchedule | null {
  const number = (value: string) => (value.trim() === "" ? NaN : Number(value));
  const numbers = (value: string) =>
    value.split(",").map((part) => (part.trim() === "" ? NaN : Number(part)));
  const candidate =
    draft.kind === "hourly"
      ? { kind: draft.kind, minute: number(draft.minute) }
      : draft.kind === "weekly"
        ? { kind: draft.kind, weekday: number(draft.weekday), time: draft.time }
        : draft.kind === "monthly"
          ? { kind: draft.kind, day: number(draft.day), time: draft.time }
          : draft.kind === "interval"
            ? {
                kind: draft.kind,
                amount: number(draft.amount),
                unit: draft.unit,
                anchorAt: draft.anchorAt,
              }
            : draft.kind === "custom"
              ? { kind: draft.kind, expression: draft.expression }
              : draft.kind === "advanced"
                ? {
                    kind: draft.kind,
                    months: numbers(draft.months),
                    days:
                      draft.dayKind === "every-day"
                        ? { kind: draft.dayKind }
                        : { kind: draft.dayKind, days: numbers(draft.days) },
                    time:
                      draft.timeKind === "at-time"
                        ? { kind: draft.timeKind, time: draft.time }
                        : { kind: draft.timeKind, amount: number(draft.amount), unit: draft.unit },
                  }
                : { kind: draft.kind, time: draft.time };
  const result = decodeSchedule(candidate);
  return Result.isSuccess(result) ? result.success : null;
}
