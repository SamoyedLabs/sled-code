import * as Schema from "effect/Schema";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Text = Schema.String.check(Schema.isMaxLength(500));
const Counts = {
  skillCount: Count,
  routineCount: Count,
  memoryCount: Count,
  fileCount: Count,
  fileBytes: Count,
};
export const OpenbotTransferSummary = Schema.Struct({
  agents: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Text,
      title: Text,
      avatarSeed: Id,
      avatarHue: Schema.NullOr(Count),
      ...Counts,
    }),
  ).check(Schema.isMaxLength(100)),
});
export const OpenbotTransferPreview = Schema.Struct({
  token: Id,
  appVersion: Text,
  exportedAt: Schema.NullOr(Text),
  agents: Schema.Array(
    Schema.Struct({
      key: Id,
      name: Text,
      title: Text,
      description: Schema.String.check(Schema.isMaxLength(2000)),
      nameExists: Schema.Boolean,
      ...Counts,
    }),
  ).check(Schema.isMaxLength(100)),
  hasSettings: Schema.Boolean,
  warnings: Schema.Array(Text).check(Schema.isMaxLength(200)),
});
export const OpenbotTransferResult = Schema.Struct({
  agents: Schema.Array(Schema.Struct({ agentId: Id, name: Text })).check(Schema.isMaxLength(100)),
  skipped: Schema.Array(Schema.Struct({ key: Id, name: Text, reason: Text })).check(
    Schema.isMaxLength(200),
  ),
  signIn: Schema.Array(Id).check(Schema.isMaxLength(32)),
  warnings: Schema.Array(Text).check(Schema.isMaxLength(200)),
});
const Options = {
  agentIds: Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  includeFiles: Schema.Boolean,
  includeSettings: Schema.Boolean,
};
export const OpenbotTransferExportOptions = Schema.Struct(Options);
export const OpenbotTransferCommand = Schema.Union([
  Schema.Struct({
    hostId: Id,
    operation: Schema.Literal("upload"),
    name: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(255),
      Schema.isPattern(/^[^/\\\u0000-\u001f]+\.zip$/i),
    ),
    size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 104857600 })),
  }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("summary") }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("pending") }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("export"), ...Options }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("stage"), requestId: Id, uploadId: Id }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("recover"), requestId: Id }),
  Schema.Struct({
    hostId: Id,
    operation: Schema.Literal("apply"),
    token: Id,
    keys: Schema.Array(Id).check(Schema.isMaxLength(100)),
    includeSettings: Schema.Boolean,
    timezone: Schema.String.check(Schema.isMaxLength(255)),
  }),
  Schema.Struct({ hostId: Id, operation: Schema.Literal("discard"), token: Id }),
]);
export type OpenbotTransferCommand = typeof OpenbotTransferCommand.Type;
export type OpenbotTransferPreview = typeof OpenbotTransferPreview.Type;
export type OpenbotTransferResult = typeof OpenbotTransferResult.Type;
export const OpenbotTransferReceipt = Schema.Struct({
  state: Schema.Literals(["staged", "applying", "complete", "uncertain", "discarded"]),
  preview: Schema.NullOr(OpenbotTransferPreview),
  result: Schema.NullOr(OpenbotTransferResult),
});
export type OpenbotTransferReceipt = typeof OpenbotTransferReceipt.Type;
export const OpenbotPendingTransfer = Schema.NullOr(
  Schema.Struct({
    requestId: Id,
    receipt: OpenbotTransferReceipt,
  }),
);

export const OpenbotNewTaskStartInput = Schema.Struct({
  hostId: Id,
  agentId: Id,
  clientMessageId: Id,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100000)),
});
