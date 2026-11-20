import * as Schema from "effect/Schema";

export const decodeOpenbotTrace = Schema.decodeUnknownOption(
  Schema.Struct({
    startedAt: Schema.optional(Schema.NullOr(Schema.String)),
    endedAt: Schema.optional(Schema.NullOr(Schema.String)),
    tokens: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
    costUsd: Schema.optional(
      Schema.NullOr(
        Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
      ),
    ),
    thoughtTitles: Schema.optional(
      Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(120))),
    ),
    subagents: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          title: Schema.String.check(Schema.isMaxLength(300)),
          agentType: Schema.NullOr(Schema.String),
          status: Schema.String,
          startedAt: Schema.String,
          endedAt: Schema.NullOr(Schema.String),
        }),
      ).check(Schema.isMaxLength(24)),
    ),
    waits: Schema.optional(
      Schema.Array(
        Schema.Struct({ id: Schema.String, startedAt: Schema.String, endedAt: Schema.String }),
      ).check(Schema.isMaxLength(500)),
    ),
    steps: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.String,
        command: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
        failed: Schema.optional(Schema.Literal(true)),
        recipientAgentIds: Schema.optional(
          Schema.Array(Schema.String).check(Schema.isMaxLength(100)),
        ),
        startedAt: Schema.optional(Schema.NullOr(Schema.String)),
        endedAt: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ).check(Schema.isMaxLength(5000)),
  }),
);
