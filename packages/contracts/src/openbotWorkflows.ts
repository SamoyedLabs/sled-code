import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Token = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Ordinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Timestamp = Schema.String.check(Schema.isMaxLength(64));
const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
const Text = Schema.String.check(Schema.isMaxLength(32_000));
const Coordinate = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: -1_000_000, maximum: 1_000_000 }),
);
const Size = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100_000),
);
const Point = Schema.Struct({ x: Coordinate, y: Coordinate });
export const OpenbotWorkflowFields = Schema.Record(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  Schema.Union([
    Schema.String.check(Schema.isMaxLength(20_000)),
    Schema.Number.check(Schema.isFinite()),
    Schema.Boolean,
  ]),
).check(Schema.makeFilter((value) => Object.keys(value).length <= 32));
export const OpenbotWorkflowNode = Schema.Struct({
  id: Id,
  kind: Token,
  at: Point,
  fields: OpenbotWorkflowFields,
  size: Schema.optional(
    Schema.Struct({
      width: Schema.optional(Size),
      height: Schema.optional(Size),
      font: Schema.optional(Size),
    }),
  ),
  locked: Schema.optional(Schema.Boolean),
  // The frozen workflow interface carries one-time and recurring schedules; keep their complete JSON.
  schedule: Schema.optional(Schema.Json),
});
export const OpenbotWorkflowGraph = Schema.Struct({
  nodes: Schema.Array(OpenbotWorkflowNode).check(Schema.isMaxLength(200)),
  edges: Schema.Array(
    Schema.Struct({
      id: Id,
      from: Id,
      to: Id,
      type: Token,
      branch: Schema.optional(Schema.Literals(["yes", "no"])),
    }),
  ).check(Schema.isMaxLength(400)),
  strokes: Schema.Array(
    Schema.Struct({
      id: Id,
      brush: Id,
      color: Id,
      width: Size,
      points: Schema.Array(Point).check(Schema.isMaxLength(2_000)),
    }),
  ).check(Schema.isMaxLength(500)),
});
export type OpenbotWorkflowGraph = typeof OpenbotWorkflowGraph.Type;
export const OpenbotWorkflowSummary = Schema.Struct({
  id: Id,
  title: Title,
  steps: Count,
  updatedAt: Timestamp,
  lastRun: Schema.NullOr(Schema.Struct({ status: Token, at: Timestamp })),
});
export type OpenbotWorkflowSummary = typeof OpenbotWorkflowSummary.Type;
export const OpenbotWorkflowDetail = Schema.Struct({
  summary: OpenbotWorkflowSummary,
  graph: OpenbotWorkflowGraph,
  revision: Count,
  triggers: Schema.Array(
    Schema.Struct({
      nodeId: Id,
      type: Token,
      nextDueAt: Schema.NullOr(Timestamp),
      webhookUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
    }),
  ).check(Schema.isMaxLength(200)),
});
export type OpenbotWorkflowDetail = typeof OpenbotWorkflowDetail.Type;
export const OpenbotWorkflowSaveResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), revision: Count }),
  Schema.Struct({ ok: Schema.Literal(false), conflict: OpenbotWorkflowDetail }),
]);
export const OpenbotWorkflowVersion = Schema.Struct({
  id: Id,
  at: Timestamp,
  kind: Token,
  revision: Count,
});
export type OpenbotWorkflowVersion = typeof OpenbotWorkflowVersion.Type;
export const OpenbotWorkflowRun = Schema.Struct({
  id: Id,
  workflowId: Id,
  number: Ordinal,
  triggerNodeId: Schema.NullOr(Id),
  source: Token,
  status: Token,
  error: Schema.NullOr(Text),
  startedAt: Timestamp,
  endedAt: Schema.NullOr(Timestamp),
});
export const OpenbotWorkflowStep = Schema.Struct({
  id: Id,
  workflowId: Id,
  runId: Schema.NullOr(Id),
  nodeId: Id,
  attempt: Ordinal,
  agentId: Schema.NullOr(Id),
  status: Token,
  output: Schema.NullOr(Text),
  branch: Schema.NullOr(Schema.Literals(["yes", "no"])),
  error: Schema.NullOr(Text),
  startedAt: Schema.NullOr(Timestamp),
  endedAt: Schema.NullOr(Timestamp),
});
export type OpenbotWorkflowStep = typeof OpenbotWorkflowStep.Type;
export const OpenbotWorkflowRunDetail = Schema.Struct({
  run: OpenbotWorkflowRun,
  steps: Schema.Array(OpenbotWorkflowStep).check(Schema.isMaxLength(2_000)),
});
export type OpenbotWorkflowRunDetail = typeof OpenbotWorkflowRunDetail.Type;
export const OpenbotWorkflowRunPage = Schema.Struct({
  runs: Schema.Array(OpenbotWorkflowRunDetail).check(Schema.isMaxLength(50)),
  soloSteps: Schema.Array(OpenbotWorkflowStep).check(Schema.isMaxLength(50)),
  nextBefore: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
});
export type OpenbotWorkflowRunPage = typeof OpenbotWorkflowRunPage.Type;

export const OpenbotWorkflowReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("workflow.list") }),
  Schema.Struct({
    operation: Schema.Literals(["workflow.get", "workflow.versions"]),
    workflowId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("workflow.versionGraph"),
    workflowId: Id,
    versionId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("workflow.runs"),
    workflowId: Id,
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
    before: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
  }),
  Schema.Struct({ operation: Schema.Literal("workflow.run"), runId: Id }),
]);
export type OpenbotWorkflowReadRequest = typeof OpenbotWorkflowReadRequest.Type;
export const OpenbotWorkflowAdminRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("workflow.create"),
    title: Title,
    graph: Schema.optional(OpenbotWorkflowGraph),
  }),
  Schema.Struct({ operation: Schema.Literal("workflow.rename"), workflowId: Id, title: Title }),
  Schema.Struct({ operation: Schema.Literal("workflow.delete"), workflowId: Id }),
  Schema.Struct({
    operation: Schema.Literal("workflow.saveGraph"),
    workflowId: Id,
    baseRevision: Count,
    graph: OpenbotWorkflowGraph,
  }),
  Schema.Struct({
    operation: Schema.Literal("workflow.restoreVersion"),
    workflowId: Id,
    versionId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("workflow.startRun"),
    workflowId: Id,
    requestId: Id,
    fromNodeId: Schema.optional(Id),
  }),
  Schema.Struct({
    operation: Schema.Literal("workflow.runStep"),
    workflowId: Id,
    nodeId: Id,
    requestId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("workflow.stopRun"), runId: Id }),
  Schema.Struct({ operation: Schema.Literal("workflow.stopStep"), stepId: Id }),
  Schema.Struct({ operation: Schema.Literal("workflow.retryStep"), stepId: Id, requestId: Id }),
  Schema.Struct({
    operation: Schema.Literal("workflow.decide"),
    stepId: Id,
    approved: Schema.Boolean,
  }),
]);
export type OpenbotWorkflowAdminRequest = typeof OpenbotWorkflowAdminRequest.Type;
