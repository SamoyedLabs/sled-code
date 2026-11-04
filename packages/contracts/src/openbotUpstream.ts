import * as Schema from "effect/Schema";
import { IsoDateTime } from "./baseSchemas.ts";

export const OpenbotRuntimeVersion = Schema.String.check(
  Schema.isPattern(/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/),
);
export const OpenbotRuntimePlatform = Schema.Literals([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
export type OpenbotRuntimePlatform = typeof OpenbotRuntimePlatform.Type;
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Compatibility = Schema.Literals(["pinned-baseline", "requires-validation"]);
export const OpenbotUpstreamAsset = Schema.Struct({
  platform: OpenbotRuntimePlatform,
  name: Schema.String.check(Schema.isMaxLength(128)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_073_741_824 })),
  sha256: Sha256,
});
export type OpenbotUpstreamAsset = typeof OpenbotUpstreamAsset.Type;
export const OpenbotUpstreamRelease = Schema.Struct({
  version: OpenbotRuntimeVersion,
  releaseCommit: Commit,
  releaseUrl: Schema.String.check(Schema.isMaxLength(256)),
  publishedAt: IsoDateTime,
  sourceLicenseUrl: Schema.String.check(Schema.isMaxLength(256)),
  sourceNoticeUrl: Schema.String.check(Schema.isMaxLength(256)),
  assets: Schema.Array(OpenbotUpstreamAsset).check(Schema.isMaxLength(5)),
  compatibility: Compatibility,
});
export type OpenbotUpstreamRelease = typeof OpenbotUpstreamRelease.Type;
export const OpenbotUpstreamStageInput = Schema.Struct({
  version: OpenbotRuntimeVersion,
  platform: OpenbotRuntimePlatform,
});
export type OpenbotUpstreamStageInput = typeof OpenbotUpstreamStageInput.Type;
export const OpenbotStagedRuntime = Schema.Struct({
  ...OpenbotUpstreamAsset.fields,
  version: OpenbotRuntimeVersion,
  releaseCommit: Commit,
  artifactPath: Schema.String.check(Schema.isMaxLength(4096)),
  stagedAt: IsoDateTime,
  compatibility: Compatibility,
  activation: Schema.Literal("blocked"),
});
export type OpenbotStagedRuntime = typeof OpenbotStagedRuntime.Type;
export const OpenbotUpstreamFailureReason = Schema.Literals([
  "configuration",
  "metadata",
  "transport",
  "integrity",
  "storage",
  "unsupported-platform",
]);
export const OpenbotUpstreamAudit = Schema.Struct({
  at: IsoDateTime,
  operation: Schema.Literals(["checked", "staged", "stage-failed"]),
  version: OpenbotRuntimeVersion,
  platform: Schema.optional(OpenbotRuntimePlatform),
  reason: Schema.optional(OpenbotUpstreamFailureReason),
});
export const OpenbotUpstreamStatus = Schema.Struct({
  baselineVersion: OpenbotRuntimeVersion,
  baselineCommit: Commit,
  available: Schema.NullOr(OpenbotUpstreamRelease),
  lastCheckedAt: Schema.NullOr(IsoDateTime),
  staged: Schema.Array(OpenbotStagedRuntime).check(Schema.isMaxLength(100)),
  audit: Schema.Array(OpenbotUpstreamAudit).check(Schema.isMaxLength(100)),
  activationAllowed: Schema.Literal(false),
  productionMigrationAllowed: Schema.Literal(false),
});
export type OpenbotUpstreamStatus = typeof OpenbotUpstreamStatus.Type;
