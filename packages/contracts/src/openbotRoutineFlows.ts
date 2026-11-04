import * as Schema from "effect/Schema";
import { OpenbotRoutineTriggerInput, OpenbotRoutineRun } from "./openbotEvents.ts";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Instruction = Schema.String.check(Schema.isMaxLength(100_000));
const NodeKey = Schema.String.check(Schema.isPattern(/^(agent|routine):[^:]{1,128}$/));
const Coordinate = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: -1_000_000, maximum: 1_000_000 }),
);
export const OpenbotRoutineFlowLink = Schema.Struct({
  id: Id,
  routineId: Id,
  fromAgentId: Id,
  toAgentId: Id,
  instruction: Instruction,
  createdAt: Schema.String,
});
export const OpenbotRoutineFlowCanvas = Schema.Struct({
  agentId: Id,
  routines: Schema.Array(
    Schema.Struct({
      routine: Schema.Struct({
        id: Id,
        agentId: Id,
        name: Schema.String,
        instruction: Instruction,
        active: Schema.Boolean,
        timezone: Schema.String,
        trigger: OpenbotRoutineTriggerInput,
        createdAt: Schema.String,
        updatedAt: Schema.String,
        limitPolicy: Schema.optional(Schema.Literals(["wait", "skip"])),
      }),
      recentRuns: Schema.Array(OpenbotRoutineRun).check(Schema.isMaxLength(50)),
      upcomingRuns: Schema.Array(Schema.String).check(Schema.isMaxLength(400)),
      steps: Schema.Array(
        Schema.Struct({
          id: Id,
          runId: Id,
          agentId: Id,
          deliveryId: Schema.NullOr(Id),
          input: Schema.String.check(Schema.isMaxLength(4000)),
          output: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4000))),
          status: Schema.Literals(["running", "succeeded", "failed", "skipped", "cancelled"]),
          error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4000))),
          createdAt: Schema.String,
          updatedAt: Schema.String,
        }),
      ).check(Schema.isMaxLength(1000)),
    }),
  ).check(Schema.isMaxLength(1000)),
  links: Schema.Array(OpenbotRoutineFlowLink).check(Schema.isMaxLength(10000)),
  positions: Schema.Array(Schema.Struct({ nodeKey: NodeKey, x: Coordinate, y: Coordinate })).check(
    Schema.isMaxLength(10000),
  ),
  placedAgentIds: Schema.Array(Id).check(Schema.isMaxLength(10000)),
});
export const OpenbotRoutineFlowReadRequest = Schema.Struct({
  operation: Schema.Literal("routineFlow.canvas"),
  agentId: Id,
});
export const OpenbotRoutineFlowCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("routineFlow.savePosition"),
    agentId: Id,
    nodeKey: NodeKey,
    x: Coordinate,
    y: Coordinate,
  }),
  Schema.Struct({
    operation: Schema.Literal("routineFlow.removePosition"),
    agentId: Id,
    nodeKey: NodeKey,
  }),
  Schema.Struct({
    operation: Schema.Literal("routineFlow.connect"),
    routineId: Id,
    fromAgentId: Id,
    toAgentId: Id,
    instruction: Schema.optional(Instruction),
  }),
  Schema.Struct({ operation: Schema.Literal("routineFlow.disconnect"), linkId: Id }),
  Schema.Struct({
    operation: Schema.Literal("routineFlow.updateLink"),
    linkId: Id,
    instruction: Instruction,
  }),
]);
export type OpenbotRoutineFlowReadRequest = typeof OpenbotRoutineFlowReadRequest.Type;
export type OpenbotRoutineFlowCommand = typeof OpenbotRoutineFlowCommand.Type;
