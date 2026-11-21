import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Value = Schema.Union([
  Schema.String.check(Schema.isMaxLength(16_384)),
  Schema.Array(Id).check(Schema.isMaxLength(64)),
]);
export const PrivilegedResponseTarget = Schema.Struct({
  agentId: Id,
  threadId: Id,
  turnId: Id,
  messageId: Id,
  blockId: Id,
  requestId: Schema.Union([Id, Schema.Int]),
});
export type PrivilegedResponseTarget = typeof PrivilegedResponseTarget.Type;
export const PrivilegedResponseRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("privilegedResponse.context"),
    target: PrivilegedResponseTarget,
  }),
  Schema.Struct({
    operation: Schema.Literal("privilegedResponse.respond"),
    target: PrivilegedResponseTarget,
    nonce: Id,
    consent: Schema.Literal(true),
    response: Schema.Struct({
      actionId: Id,
      values: Schema.optional(Schema.Record(Id, Value).check(Schema.isMaxProperties(64))),
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("privilegedResponse.result"),
    target: PrivilegedResponseTarget,
    nonce: Id,
  }),
]);
export type PrivilegedResponseRequest = typeof PrivilegedResponseRequest.Type;
export const PrivilegedResponseResult = Schema.Struct({
  nonce: Id,
  status: Schema.Literals(["pending", "answered", "interrupted", "unknown"]),
});
export type PrivilegedResponseResult = typeof PrivilegedResponseResult.Type;
export const PRIVILEGED_RESPONSE_CAPABILITY = "sled-privileged-responses-v1";
