import * as Schema from "effect/Schema";
const Count = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const Totals = Schema.Struct({
  uncachedInput: Schema.NullOr(Count),
  cachedInput: Schema.NullOr(Count),
  cacheCreation: Schema.NullOr(Count),
  output: Schema.NullOr(Count),
  processedTokens: Count,
  estimatedCostUsd: Schema.NullOr(Count),
  sessions: Count,
  userMessages: Count,
  assistantMessages: Count,
  turns: Count,
  missingUsageTurns: Count,
  unpricedRecords: Count,
  incompleteRecords: Count,
});
const ReportFields = {
  startDate: Schema.String,
  endDate: Schema.String,
  timeZone: Schema.String,
  collectionStartedAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
  totals: Totals,
  daily: Schema.Array(Schema.Struct({ ...Totals.fields, date: Schema.String })),
  models: Schema.Array(
    Schema.Struct({ ...Totals.fields, provider: Schema.String, model: Schema.String }),
  ),
};
const AgentReport = Schema.Struct({ ...ReportFields, agentId: Schema.String });
export const Report = Schema.Struct({
  ...ReportFields,
  agentId: Schema.optional(Schema.String),
  providerDaily: Schema.optional(
    Schema.Array(
      Schema.Struct({
        date: Schema.String,
        provider: Schema.String,
        estimatedCostUsd: Schema.NullOr(Count),
        processedTokens: Count,
        cachedInput: Schema.optional(Schema.NullOr(Count)),
      }),
    ),
  ),
  agents: Schema.Array(Schema.Struct({ ...Totals.fields, agentId: Schema.String })),
});

export type Total = typeof Totals.Type;
export type UsageReport = typeof Report.Type;
export type AnalyticsDay = UsageReport["daily"][number];
export type AnalyticsProviderDay = NonNullable<UsageReport["providerDaily"]>[number];
export type AnalyticsModel = UsageReport["models"][number];
export function analyticsTokens(row: {
  processedTokens: number;
  cachedInput?: number | null | undefined;
}) {
  return Math.max(0, row.processedTokens - (row.cachedInput ?? 0));
}
export const decodeReport = Schema.decodeUnknownResult(Report);

export const decodeAgentReport = Schema.decodeUnknownResult(AgentReport);
