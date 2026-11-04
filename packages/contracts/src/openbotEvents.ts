import * as Schema from "effect/Schema";

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Text = Schema.String.check(Schema.isMaxLength(4096));
const ApprovalText = Schema.String.check(Schema.isMaxLength(240));
export const OpenbotApprovalContext = Schema.Struct({
  command: Schema.NullOr(ApprovalText),
  cwd: Schema.NullOr(ApprovalText),
  reason: Schema.NullOr(ApprovalText),
  grantRoot: Schema.NullOr(ApprovalText),
  permissions: Schema.NullOr(
    Schema.Struct({
      fileSystem: Schema.Struct({
        read: Schema.Array(ApprovalText).check(Schema.isMaxLength(3)),
        write: Schema.Array(ApprovalText).check(Schema.isMaxLength(3)),
      }),
      network: Schema.Boolean,
    }),
  ),
  truncated: Schema.Boolean,
});
export const OpenbotBrowserSecretContext = Schema.Struct({
  method: Schema.Literals(["password", "otp", "authenticator"]),
  origin: Schema.String.check(Schema.isMaxLength(2048)),
  digits: Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 12 })),
  requiresReload: Schema.optional(Schema.Literal(true)),
});
export const OpenbotAttentionQuestion = Schema.Struct({
  id: Identifier,
  isSecret: Schema.Boolean,
  header: Text,
  question: Text,
  options: Schema.NullOr(
    Schema.Array(Schema.Struct({ label: Text, description: Text })).check(Schema.isMaxLength(64)),
  ),
  multiSelect: Schema.optional(Schema.Boolean),
});
export const OpenbotAttentionRequest = Schema.Struct({
  kind: Schema.Literals(["approval", "prompt", "takeover"]),
  requestId: Schema.Union([Identifier, Schema.Int]),
  agentId: Identifier,
  threadId: Schema.optional(Identifier),
  turnId: Schema.optional(Identifier),
  approvalKind: Schema.optional(Schema.Literals(["command", "file-change", "permissions"])),
  approval: Schema.optional(OpenbotApprovalContext),
  tabId: Schema.optional(Identifier),
  takeoverReason: Schema.optional(Schema.Literal("sign-in-blocked")),
  browserSecret: Schema.optional(OpenbotBrowserSecretContext),
  questions: Schema.optional(Schema.Array(OpenbotAttentionQuestion).check(Schema.isMaxLength(32))),
});
export type OpenbotAttentionRequest = typeof OpenbotAttentionRequest.Type;
export const OpenbotAttentionSnapshot = Schema.Struct({
  hostId: Schema.NullOr(Identifier),
  state: Schema.Literals(["disconnected", "connecting", "ready"]),
  complete: Schema.Boolean,
  requests: Schema.Array(OpenbotAttentionRequest).check(Schema.isMaxLength(4)),
});
export type OpenbotAttentionSnapshot = typeof OpenbotAttentionSnapshot.Type;
export const OpenbotChange = Schema.Struct({
  hostId: Schema.NullOr(Identifier),
  resource: Schema.Literals([
    "all",
    "agents",
    "conversation",
    "tasks",
    "memory",
    "routines",
    "queue",
    "browser",
    "attention",
    "configuration",
  ]),
  agentId: Schema.optional(Identifier),
});
export type OpenbotChange = typeof OpenbotChange.Type;
