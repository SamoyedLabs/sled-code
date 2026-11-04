import * as Schema from "effect/Schema";

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Text = Schema.String.check(Schema.isMaxLength(4096));
const ApprovalText = Schema.String.check(Schema.isMaxLength(240));
export const OpenbotApprovalContext = Schema.Struct({
  command: Schema.NullOr(ApprovalText),
  cwd: Schema.NullOr(ApprovalText),
  reason: Schema.NullOr(ApprovalText),
  grantRoot: Schema.NullOr(ApprovalText),
  permissions: Schema.NullOr(
    Schema.Struct({
      fileSystem: Schema.Struct({
        read: Schema.Array(ApprovalText).check(Schema.isMaxLength(3)),
        write: Schema.Array(ApprovalText).check(Schema.isMaxLength(3)),
      }),
      network: Schema.Boolean,
    }),
  ),
  truncated: Schema.Boolean,
});
export const OpenbotBrowserSecretContext = Schema.Struct({
  method: Schema.Literals(["password", "otp", "authenticator"]),
  origin: Schema.String.check(Schema.isMaxLength(2048)),
  digits: Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 12 })),
  requiresReload: Schema.optional(Schema.Literal(true)),
});
export const OpenbotAttentionQuestion = Schema.Struct({
  id: Identifier,
  isSecret: Schema.Boolean,
  header: Text,
  question: Text,
  options: Schema.NullOr(
    Schema.Array(Schema.Struct({ label: Text, description: Text })).check(Schema.isMaxLength(64)),
  ),
  multiSelect: Schema.optional(Schema.Boolean),
});
export const OpenbotAttentionRequest = Schema.Struct({
  kind: Schema.Literals(["approval", "prompt", "takeover"]),
  requestId: Schema.Union([Identifier, Schema.Int]),
  agentId: Identifier,
  threadId: Schema.optional(Identifier),
  turnId: Schema.optional(Identifier),
  approvalKind: Schema.optional(Schema.Literals(["command", "file-change", "permissions"])),
  approval: Schema.optional(OpenbotApprovalContext),
  tabId: Schema.optional(Identifier),
  takeoverReason: Schema.optional(Schema.Literal("sign-in-blocked")),
  browserSecret: Schema.optional(OpenbotBrowserSecretContext),
  questions: Schema.optional(Schema.Array(OpenbotAttentionQuestion).check(Schema.isMaxLength(32))),
});
export type OpenbotAttentionRequest = typeof OpenbotAttentionRequest.Type;
export const OpenbotAttentionSnapshot = Schema.Struct({
  hostId: Schema.NullOr(Identifier),
  state: Schema.Literals(["disconnected", "connecting", "ready"]),
  complete: Schema.Boolean,
  requests: Schema.Array(OpenbotAttentionRequest).check(Schema.isMaxLength(4)),
});
export type OpenbotAttentionSnapshot = typeof OpenbotAttentionSnapshot.Type;
export const OpenbotChange = Schema.Struct({
  hostId: Schema.NullOr(Identifier),
  resource: Schema.Literals([
    "all",
    "agents",
    "conversation",
    "tasks",
    "memory",
    "routines",
    "queue",
    "browser",
    "attention",
    "configuration",
  ]),
  agentId: Schema.optional(Identifier),
});
export type OpenbotChange = typeof OpenbotChange.Type;

const Timestamp = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Time = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
const Positive = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(100_000),
);
const Weekday = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6));
const MonthDay = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(31));
const Month = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(12));
const Unit = Schema.Literals(["minutes", "hours", "days"]);
const Days = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("every-day") }),
  Schema.Struct({
    kind: Schema.Literal("days-of-week"),
    days: Schema.Array(Weekday).check(Schema.isMinLength(1), Schema.isMaxLength(7)),
  }),
  Schema.Struct({
    kind: Schema.Literal("days-of-month"),
    days: Schema.Array(MonthDay).check(Schema.isMinLength(1), Schema.isMaxLength(31)),
  }),
]);
export const OpenbotRoutineSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("hourly"),
    minute: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(59)),
  }),
  Schema.Struct({ kind: Schema.Literals(["daily", "weekdays"]), time: Time }),
  Schema.Struct({ kind: Schema.Literal("weekly"), weekday: Weekday, time: Time }),
  Schema.Struct({ kind: Schema.Literal("monthly"), day: MonthDay, time: Time }),
  Schema.Struct({
    kind: Schema.Literal("interval"),
    amount: Positive,
    unit: Unit,
    anchorAt: Timestamp,
  }),
  Schema.Struct({
    kind: Schema.Literal("custom"),
    expression: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  }),
  Schema.Struct({
    kind: Schema.Literal("advanced"),
    months: Schema.Array(Month).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    days: Days,
    time: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("at-time"), time: Time }),
      Schema.Struct({
        kind: Schema.Literal("every"),
        amount: Positive,
        unit: Schema.Literals(["minutes", "hours"]),
      }),
    ]),
  }),
]);

const EventId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const EventText = Schema.String.check(Schema.isMaxLength(100_000));
export const OpenbotRoutineOwner = Schema.Struct({
  kind: Schema.Literals(["agent", "channel"]),
  id: EventId,
});
export const OpenbotRoutineTriggerInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("schedule"), schedule: OpenbotRoutineSchedule }),
  Schema.Struct({
    kind: Schema.Literal("webhook"),
    eventType: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
    filters: Schema.Array(
      Schema.Struct({
        pointer: Schema.String.check(
          Schema.isMaxLength(2048),
          Schema.isPattern(/^(?:|\/(?:[^~]|~[01])*)$/),
        ),
        value: Schema.Union([
          Schema.Null,
          Schema.String,
          Schema.Boolean,
          Schema.Number.check(Schema.isFinite()),
        ]),
      }),
    ).check(Schema.isMaxLength(128)),
  }),
]);
export const OpenbotEventRoutineInput = Schema.Struct({
  owner: OpenbotRoutineOwner,
  id: Schema.optional(EventId),
  name: Schema.String.check(Schema.isMaxLength(256)),
  instruction: EventText,
  active: Schema.Boolean,
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  trigger: OpenbotRoutineTriggerInput,
  limitPolicy: Schema.optional(Schema.Literals(["wait", "skip"])),
  missedPolicy: Schema.optional(Schema.Literals(["skip", "run-once"])),
});
export const OpenbotEventRoutine = Schema.Struct({
  ...OpenbotEventRoutineInput.fields,
  id: EventId,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const OpenbotRoutineRun = Schema.Struct({
  id: EventId,
  routineId: EventId,
  triggerId: Schema.NullOr(EventId),
  kind: Schema.Literals(["scheduled", "manual"]),
  scheduledFor: Timestamp,
  routineName: Schema.String,
  instruction: Schema.String.check(Schema.isMaxLength(200_000)),
  status: Schema.Literals([
    "queued",
    "running",
    "needs-attention",
    "succeeded",
    "failed",
    "interrupted",
    "cancelled",
  ]),
  error: Schema.NullOr(EventText),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  source: Schema.optional(Schema.Literals(["test", "script", "webhook"])),
  missed: Schema.optional(
    Schema.Struct({
      count: Schema.Int.check(Schema.isGreaterThan(0)),
      until: Schema.NullOr(Timestamp),
    }),
  ),
  deliveryId: Schema.optional(Schema.NullOr(EventId)),
  requestMessageId: Schema.optional(Schema.NullOr(EventId)),
});
export const OpenbotEventReceipt = Schema.Struct({
  eventType: Schema.String.check(Schema.isMaxLength(256)),
  status: Schema.Literals(["started", "ignored"]),
  reason: Schema.NullOr(Schema.Literals(["event-type", "filter", "inactive"])),
  runId: Schema.NullOr(EventId),
});
export const OpenbotEventActivity = Schema.Struct({
  ...OpenbotEventReceipt.fields,
  kind: Schema.Literal("received"),
  id: EventId,
  deliveryId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  occurredAt: Timestamp,
});
export const OpenbotEventAdminRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("events.status") }),
  Schema.Struct({ operation: Schema.Literal("events.list"), owner: OpenbotRoutineOwner }),
  Schema.Struct({ operation: Schema.Literal("events.save"), ...OpenbotEventRoutineInput.fields }),
  Schema.Struct({
    operation: Schema.Literals([
      "events.delete",
      "events.test",
      "events.rotateSecret",
      "events.sendTest",
    ]),
    owner: OpenbotRoutineOwner,
    id: EventId,
  }),
  Schema.Struct({
    operation: Schema.Literals(["events.activity", "events.runs"]),
    owner: OpenbotRoutineOwner,
    routineId: EventId,
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
]);
export type OpenbotEventAdminRequest = typeof OpenbotEventAdminRequest.Type;
