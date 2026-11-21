import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Count = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Categories = Schema.Literals([
  "systemPrompt",
  "memoryFiles",
  "tools",
  "skills",
  "toolResults",
  "messages",
  "other",
]);

/** The bounded context-usage-v1 data supplied by the linked host. */
export const OpenbotContextState = Schema.Struct({
  botId: Id,
  threadId: Id,
  usage: Schema.NullOr(
    Schema.Struct({
      usedTokens: Count,
      windowTokens: Count.check(Schema.isGreaterThan(0)),
      autoCompactAt: Schema.NullOr(Count.check(Schema.isLessThanOrEqualTo(1))),
      nativeManaged: Schema.Boolean,
      estimated: Schema.optionalKey(Schema.Boolean),
      categories: Schema.optionalKey(
        Schema.Array(Schema.Struct({ category: Categories, tokens: Count })).check(
          Schema.isMaxLength(7),
          Schema.makeFilter(
            (rows) => new Set(rows.map((row) => row.category)).size === rows.length,
          ),
        ),
      ),
    }),
  ),
  compaction: Schema.NullOr(
    Schema.Struct({
      id: Id,
      startedAt: Count,
      status: Schema.Literals(["running", "completed", "failed"]),
      beforeTokens: Schema.optionalKey(Count),
      afterTokens: Schema.optionalKey(Count),
      expectedMs: Schema.optionalKey(Count),
    }),
  ),
});
export type OpenbotContextState = typeof OpenbotContextState.Type;
