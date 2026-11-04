import * as Schema from "effect/Schema";
import { OpenbotAdminRequest, OpenbotReadRequest } from "./openbotApi.ts";

export const OpenbotHostReadInput = Schema.Struct({
  hostId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  request: OpenbotReadRequest,
});
export type OpenbotHostReadInput = typeof OpenbotHostReadInput.Type;

export const OpenbotHostAdminInput = Schema.Struct({
  hostId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  request: OpenbotAdminRequest,
});
export type OpenbotHostAdminInput = typeof OpenbotHostAdminInput.Type;

export const OpenbotHostStatus = Schema.Struct({
  hostId: Schema.optional(Schema.String),
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
