import * as Schema from "effect/Schema";

// Wire fields retained from OpenBot iOS 1.4.11's conversation subagent and memory contracts.
const bounded = (size: number) => Schema.String.check(Schema.isMaxLength(size));
const memory = Schema.Struct({
  memoryId: bounded(128),
  action: Schema.Literals(["saved", "updated", "forgotten", "notChanged"]),
  text: bounded(500),
  previousText: Schema.optional(bounded(500)),
});
const worker = Schema.Struct({
  id: bounded(128),
  title: bounded(300),
  agentType: Schema.optional(Schema.NullOr(bounded(80))),
  status: Schema.Literals(["running", "completed", "failed", "stopped"]),
  prompt: Schema.NullOr(bounded(2_000)),
  startedAt: bounded(160),
  endedAt: Schema.NullOr(bounded(160)),
  error: Schema.NullOr(bounded(500)),
  background: Schema.optional(Schema.Literal(true)),
  steps: Schema.Array(
    Schema.Struct({
      id: bounded(128),
      kind: Schema.Literals([
        "thinking",
        "text",
        "search",
        "read",
        "edit",
        "command",
        "web",
        "tool",
      ]),
      text: bounded(500),
    }),
  ).check(Schema.isMaxLength(40)),
});
const decodeMemory = Schema.decodeUnknownOption(Schema.Array(memory).check(Schema.isMaxLength(50)));
const decodeWorkers = Schema.decodeUnknownOption(
  Schema.Array(worker).check(Schema.isMaxLength(24)),
);
export function botMemoryRows(value: unknown) {
  const result = decodeMemory(value);
  return result._tag === "Some" ? result.value : [];
}

export function botSubagentRows(value: unknown) {
  const result = decodeWorkers(value);
  return result._tag === "Some" ? result.value : [];
}
