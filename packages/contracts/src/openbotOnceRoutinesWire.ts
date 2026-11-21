// Sled-only negotiated routines: full local schedules without changing frozen released routes.
import { isDynamicRecord, isString } from "./openbotPinnedSettings/runtime-values.ts";
import {
  adminRoute,
  fields,
  identifier,
  list,
  string,
  nullable,
  boolean,
  oneOf,
  type AdminDecoder,
  type OptionalRouteCodec,
} from "./openbotPinnedSettings/admin-wire.ts";
import {
  routineSchedule,
  routineTrigger,
  routineTriggerInput,
  routineTime,
} from "./openbotEventsWire.ts";
export const SLED_ONCE_ROUTINES_CAPABILITY = "sled-once-routines-v1";
export const SLED_ONCE_ROUTINES_ROUTES = {
  list: "/v1/sled/once-routines/list",
  save: "/v1/sled/once-routines/save",
  canvas: "/v1/sled/once-routines/canvas",
} as const;
const date: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new Error("Invalid routine date.");
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0))
    throw new Error("Invalid routine date.");
  return value;
};
const once = fields({ kind: oneOf("once"), date, time: routineTime });
const fullSchedule: AdminDecoder = (value) =>
  isDynamicRecord(value) && value.kind === "once" ? once(value) : routineSchedule(value);
const fullTrigger: AdminDecoder = (value) =>
  isDynamicRecord(value) && value.kind === "schedule"
    ? fields({ kind: oneOf("schedule"), schedule: fullSchedule })(value)
    : routineTrigger(value);
const fullInput: AdminDecoder = (value) =>
  isDynamicRecord(value) && value.kind === "schedule"
    ? fields({ kind: oneOf("schedule"), schedule: fullSchedule })(value)
    : routineTriggerInput(value);
const owner = fields({ kind: oneOf("agent"), id: identifier });
const routine = fields(
  {
    id: identifier,
    owner,
    name: string(256),
    instruction: string(100000),
    active: boolean,
    timezone: string(128),
    trigger: fullTrigger,
    createdAt: string(64),
    updatedAt: string(64),
  },
  { limitPolicy: oneOf("wait", "skip"), missedPolicy: oneOf("skip", "run-once") },
);
const timestamp = string(64),
  instruction = string(100000),
  stepText = string(4000);
const coordinate: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error("Invalid routine flow coordinate.");
  }
  return value;
};
const nodeKey: AdminDecoder = (value) => {
  if (!isString(value) || !/^(agent|routine):[^:]{1,128}$/u.test(value))
    throw new Error("Invalid routine flow node.");
  return value;
};
const link = fields({
  id: identifier,
  routineId: identifier,
  fromAgentId: identifier,
  toAgentId: identifier,
  instruction,
  createdAt: timestamp,
});
const step = fields({
  id: identifier,
  runId: identifier,
  agentId: identifier,
  deliveryId: nullable(identifier),
  input: stepText,
  output: nullable(stepText),
  status: oneOf("running", "succeeded", "failed", "skipped", "cancelled"),
  error: nullable(stepText),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const run = fields({
  id: identifier,
  routineId: identifier,
  triggerId: nullable(identifier),
  kind: oneOf("scheduled", "manual"),
  scheduledFor: timestamp,
  routineName: string(256),
  instruction,
  status: oneOf(
    "queued",
    "running",
    "needs-attention",
    "succeeded",
    "failed",
    "interrupted",
    "cancelled",
  ),
  error: nullable(string(100_000)),
  createdAt: timestamp,
  updatedAt: timestamp,
  agentId: identifier,
  deliveryId: nullable(identifier),
});
const routineInfo = fields(
  {
    id: identifier,
    agentId: identifier,
    name: string(256),
    instruction,
    active: boolean,
    timezone: string(128),
    trigger: fullTrigger,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { limitPolicy: oneOf("wait", "skip") },
);
const canvas = fields({
  agentId: identifier,
  routines: list(
    fields({
      routine: routineInfo,
      recentRuns: list(run, 50),
      upcomingRuns: list(timestamp, 400),
      steps: list(step, 1_000),
    }),
    1_000,
  ),
  links: list(link, 10_000),
  positions: list(fields({ nodeKey, x: coordinate, y: coordinate }), 10_000),
  placedAgentIds: list(identifier, 10_000),
});

export const SLED_ONCE_ROUTINES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SLED_ONCE_ROUTINES_ROUTES.list, adminRoute(fields({ owner }), list(routine, 10000))],
  [
    SLED_ONCE_ROUTINES_ROUTES.save,
    adminRoute(
      fields(
        {
          owner,
          name: string(256),
          instruction: string(100000),
          active: boolean,
          timezone: string(128),
          trigger: fullInput,
        },
        {
          id: identifier,
          limitPolicy: oneOf("wait", "skip"),
          missedPolicy: oneOf("skip", "run-once"),
        },
      ),
      fields({ routine, secret: nullable(string(1024)) }),
    ),
  ],
  [SLED_ONCE_ROUTINES_ROUTES.canvas, adminRoute(fields({ agentId: identifier }), canvas)],
]);
