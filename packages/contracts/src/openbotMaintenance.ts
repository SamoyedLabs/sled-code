import * as Schema from "effect/Schema";
import { IsoDateTime } from "./baseSchemas.ts";
import { ProjectId, CommandId, ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OpenbotRuntimePlatform, OpenbotUpstreamRelease } from "./openbotUpstream.ts";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12000));
export const OpenbotMaintenancePolicy = Schema.Struct({
  enabled: Schema.Boolean,
  intervalHours: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 720 })),
  authority: Schema.Literals(["check", "review", "stage"]),
  projectId: ProjectId,
  modelSelection: ModelSelection,
  baseRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  platform: OpenbotRuntimePlatform,
});
export type OpenbotMaintenancePolicy = typeof OpenbotMaintenancePolicy.Type;
export const OpenbotMaintenanceReport = Schema.Struct({
  sourceComparison: Text,
  findings: Text,
  evidence: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["transport", "desktop", "native", "profile-migration", "rollback"]),
      artifact: Text,
      outcome: Schema.Literals(["passed", "failed", "not-run"]),
    }),
  ).check(Schema.isMaxLength(30)),
  decisionRequest: Text,
});
export const OpenbotCompatibilityIdentity = Schema.Struct({
  releaseCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  patchSetSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  profileSchemaVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  fixtureVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
export type OpenbotCompatibilityIdentity = typeof OpenbotCompatibilityIdentity.Type;
export const OpenbotCompatibilityCheck = Schema.Struct({
  kind: Schema.Literals([
    "source",
    "patches",
    "build",
    "transport",
    "desktop",
    "native",
    "profile-migration",
    "rollback",
  ]),
  outcome: Schema.Literals(["passed", "failed", "not-run"]),
  detail: Schema.String.check(Schema.isMaxLength(4096)),
});
export type OpenbotCompatibilityCheck = typeof OpenbotCompatibilityCheck.Type;
export const OpenbotCompatibilityEvidence = Schema.Struct({
  runId: Text,
  threadId: ThreadId,
  identity: OpenbotCompatibilityIdentity,
  state: Schema.Literals(["running", "eligible", "failed", "requires-validation"]),
  checks: Schema.Array(OpenbotCompatibilityCheck),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  artifactPath: Schema.optional(Schema.String),
});
export type OpenbotCompatibilityEvidence = typeof OpenbotCompatibilityEvidence.Type;
export const OpenbotCompatibilityRunInput = Schema.Struct({
  runId: Text,
  threadId: ThreadId,
  identity: OpenbotCompatibilityIdentity,
  artifactRelativePath: Text,
  patchRelativePaths: Schema.Array(Text).check(Schema.isMaxLength(100)),
});
export type OpenbotCompatibilityRunInput = typeof OpenbotCompatibilityRunInput.Type;

export const OpenbotMaintenanceProposal = Schema.Struct({
  id: Text,
  release: OpenbotUpstreamRelease,
  platform: OpenbotRuntimePlatform,
  createdAt: IsoDateTime,
  state: Schema.Literals([
    "proposed",
    "review-queued",
    "reviewing",
    "decision-required",
    "accepted",
    "rejected",
  ]),
  reviewPolicy: Schema.NullOr(OpenbotMaintenancePolicy),
  reviewCommandId: Schema.NullOr(CommandId),
  reviewThreadId: Schema.NullOr(ThreadId),
  report: Schema.NullOr(OpenbotMaintenanceReport),
  decision: Schema.NullOr(Schema.Struct({ at: IsoDateTime, note: Text, accept: Schema.Boolean })),
  stagedAt: Schema.NullOr(IsoDateTime),
  preparationThreadId: Schema.optional(ThreadId),
  validationRunId: Schema.optional(Text),
  validation: Schema.optional(OpenbotCompatibilityEvidence),
  validationInput: Schema.optional(OpenbotCompatibilityRunInput),
  compatibility: Schema.Literals(["requires-validation", "validated"]),
});
export type OpenbotMaintenanceProposal = typeof OpenbotMaintenanceProposal.Type;
export const OpenbotMaintenanceState = Schema.Struct({
  revision: Schema.Int,
  policy: Schema.NullOr(OpenbotMaintenancePolicy),
  nextCheckAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Text),
  proposals: Schema.Array(OpenbotMaintenanceProposal).check(Schema.isMaxLength(100)),
});
export type OpenbotMaintenanceState = typeof OpenbotMaintenanceState.Type;

export const OpenbotMaintenanceCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("configure"),
    expectedRevision: Schema.Int,
    policy: Schema.NullOr(OpenbotMaintenancePolicy),
  }),
  Schema.Struct({ action: Schema.Literal("check") }),
  Schema.Struct({ action: Schema.Literal("review"), proposalId: Text }),
  Schema.Struct({
    action: Schema.Literal("report"),
    proposalId: Text,
    threadId: ThreadId,
    report: OpenbotMaintenanceReport,
  }),
  Schema.Struct({
    action: Schema.Literal("decide"),
    proposalId: Text,
    expectedRevision: Schema.Int,
    accept: Schema.Boolean,
    note: Text,
  }),
  Schema.Struct({ action: Schema.Literal("stage"), proposalId: Text }),
  Schema.Struct({ action: Schema.Literal("prepare"), proposalId: Text }),
  Schema.Struct({ action: Schema.Literal("validate-prepared"), proposalId: Text }),
  Schema.Struct({ action: Schema.Literal("cancel-validation"), proposalId: Text }),
  Schema.Struct({
    action: Schema.Literal("validate"),
    proposalId: Text,
    input: OpenbotCompatibilityRunInput,
  }),
  Schema.Struct({ action: Schema.Literal("promote"), proposalId: Text, runId: Text }),
]);
export type OpenbotMaintenanceCommand = typeof OpenbotMaintenanceCommand.Type;
