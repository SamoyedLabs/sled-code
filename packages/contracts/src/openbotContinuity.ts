import * as Schema from "effect/Schema";
import { EnvironmentId, IsoDateTime, ThreadId } from "./baseSchemas.ts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const OpenbotNotificationTarget = Schema.Struct({
  kind: Schema.Literal("bot"),
  environmentId: EnvironmentId,
  hostId: Id,
  agentId: Id,
  taskId: Schema.optional(Id),
  channelId: Schema.optional(Id),
  routineId: Schema.optional(Id),
  routineRunId: Schema.optional(Id),
});
export type OpenbotNotificationTarget = typeof OpenbotNotificationTarget.Type;
export const OpenbotNotification = Schema.Struct({
  eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  target: OpenbotNotificationTarget,
  codingTarget: Schema.optional(
    Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId }),
  ),
  phase: Schema.Literals([
    "executing",
    "needs_approval",
    "needs_input",
    "completed",
    "failed",
    "cancelled",
    "stale",
  ]),
  updatedAt: IsoDateTime,
});
export type OpenbotNotification = typeof OpenbotNotification.Type;
export const OpenbotContinuityCommand = Schema.Union([
  Schema.Struct({ action: Schema.Literal("status") }),
  Schema.Struct({ action: Schema.Literal("configure"), enabled: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal("retry") }),
]);
export type OpenbotContinuityCommand = typeof OpenbotContinuityCommand.Type;
export const OpenbotContinuityStatus = Schema.Struct({
  enabled: Schema.Boolean,
  transport: Schema.Literals(["configured", "configuration-required", "unsupported"]),
  pending: Schema.Int,
  delivered: Schema.Int,
  revoked: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
});
export type OpenbotContinuityStatus = typeof OpenbotContinuityStatus.Type;
