import * as Schema from "effect/Schema";

export const OpenbotHostStatus = Schema.Struct({
  state: Schema.Literals(["disabled", "stopped", "starting", "ready", "failed"]),
  reason: Schema.optional(
    Schema.Literals([
      "disabled",
      "configuration",
      "filesystem",
      "spawn",
      "readiness",
      "timeout",
      "exited",
    ]),
  ),
});
export type OpenbotHostStatus = typeof OpenbotHostStatus.Type;

export const OpenbotAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
});

export const OpenbotAgentList = Schema.Array(OpenbotAgent);

export class OpenbotError extends Schema.TaggedError<OpenbotError>()("OpenbotError", {
  message: Schema.String,
}) {}
