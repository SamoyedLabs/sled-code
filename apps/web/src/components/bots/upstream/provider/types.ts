// Read models retain the pinned 0.60.0 fields; unknown providers and states remain visible.
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { AgentProviderId } from "./identity";
export type { AgentProviderId } from "./identity";
export const Effort = Schema.Literals([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export type AgentReasoningEffort = typeof Effort.Type;
export type AgentModelListing = "new" | "older";
export type AgentModelId = string;
export type CustomProviderHarness = "opencode" | "pi";
export interface CustomProviderSummary {
  id: string;
  name?: string;
  harness?: CustomProviderHarness | undefined;
}
export interface CustomAgentSummary {
  id: string;
  name: string;
}
export const Account = Schema.Struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  state: Schema.String,
  message: Schema.NullOr(Schema.String),
});
export type ProviderAccountStatus = typeof Account.Type;
export const ProviderStatus = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  version: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  displayName: Schema.optional(Schema.String),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  off: Schema.optional(Schema.Boolean),
  connectionState: Schema.optional(Schema.Literal("connecting")),
  signInPending: Schema.optional(Schema.Boolean),
  checkError: Schema.optional(Schema.NullOr(Schema.String)),
  lastError: Schema.optional(Schema.NullOr(Schema.String)),
  restartPending: Schema.optional(Schema.Boolean),
  cliSource: Schema.optional(Schema.Literals(["system", "managed"])),
  accounts: Schema.optional(Schema.mutable(Schema.Array(Account))),
});
export interface AgentProviderStatus extends Omit<typeof ProviderStatus.Type, "id"> {
  id: AgentProviderId;
}
export const Status = Schema.Struct({
  phase: Schema.String,
  providers: Schema.optional(Schema.mutable(Schema.Array(ProviderStatus))),
});
export type AgentStatus = typeof Status.Type;
export const Model = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  defaultReasoningEffort: Effort,
  supportedReasoningEfforts: Schema.mutable(Schema.Array(Effort)),
  reasoningEffortConfigurable: Schema.optional(Schema.Boolean),
  fastServiceTier: Schema.optional(Schema.String),
  listing: Schema.optional(Schema.Literals(["new", "older"])),
});
export type ClientAgentModelOption = typeof Model.Type;
export interface ProviderRuntimeStatus {
  availableVersion?: string | null | undefined;
  phase: "not-downloaded" | "downloading" | "finishing" | "ready" | "download-error";
  progress: number | null;
  message: string | null;
  version: string | null;
}
const NumberValue = Schema.Number.check(Schema.isFinite());
export const UsageWindow = Schema.Struct({
  usedPercent: NumberValue,
  windowDurationMins: Schema.NullOr(NumberValue),
  resetsAt: Schema.NullOr(NumberValue),
});
export type AccountUsageWindow = typeof UsageWindow.Type;
const UsageGroup = Schema.Struct({
  name: Schema.String,
  models: Schema.mutable(Schema.Array(Schema.String)),
  primary: Schema.NullOr(UsageWindow),
  secondary: Schema.NullOr(UsageWindow),
});
export const UsageLimit = Schema.Struct({
  id: Schema.String,
  accountId: Schema.optional(Schema.String),
  primary: Schema.NullOr(UsageWindow),
  secondary: Schema.NullOr(UsageWindow),
  tertiary: Schema.optional(UsageWindow),
  groups: Schema.optional(Schema.mutable(Schema.Array(UsageGroup))),
  sharedQuotaWith: Schema.optional(Schema.String),
});
export type AccountUsageLimit = typeof UsageLimit.Type;
export const Usage = Schema.Struct({ limits: Schema.mutable(Schema.Array(UsageLimit)) });
export type AccountUsage = typeof Usage.Type;
const decodeUsage = Schema.decodeUnknownResult(Usage);
const decodeStatus = Schema.decodeUnknownResult(Status);
const decodeModels = Schema.decodeUnknownResult(Schema.mutable(Schema.Array(Model)));
const checkEffort = Schema.is(Effort);
export function readAccountUsage(value: unknown): AccountUsage | null {
  const parsed = decodeUsage(value);
  return Result.isSuccess(parsed) ? parsed.success : null;
}
export function readAgentStatus(value: unknown): AgentStatus | null {
  const parsed = decodeStatus(value);
  return Result.isSuccess(parsed) ? parsed.success : null;
}
export function readModelOptions(value: unknown): ClientAgentModelOption[] {
  const parsed = decodeModels(value);
  return Result.isSuccess(parsed) ? parsed.success : [];
}
export function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return checkEffort(value);
}
