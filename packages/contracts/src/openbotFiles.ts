import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
const Name = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^/\\\u0000-\u001f\u007f]+$/),
);
const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.isPattern(/^[^\u0000]+$/),
);
const Size = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 104_857_600 }));
const Mime = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^\r\n\u0000]+$/),
);
export const OpenbotFileScope = Schema.Struct({ hostId: Id, agentId: Id });
export type OpenbotFileScope = typeof OpenbotFileScope.Type;
export const OpenbotFileTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main") }),
  Schema.Struct({ kind: Schema.Literal("task"), taskId: Id }),
  Schema.Struct({ kind: Schema.Literal("new-task") }),
]);
export type OpenbotFileTarget = typeof OpenbotFileTarget.Type;
export const OpenbotFileSummary = Schema.Struct({
  id: Id,
  name: Name,
  size: Size,
  kind: Schema.Literals(["image", "file"]),
  mimeType: Mime,
  previewKind: Schema.Literals(["image", "pdf", "text", "none"]),
});
export type OpenbotFileSummary = typeof OpenbotFileSummary.Type;
export const OpenbotWorkspaceListInput = Schema.Struct({ ...OpenbotFileScope.fields, path: Path });
export type OpenbotWorkspaceListInput = typeof OpenbotWorkspaceListInput.Type;
export const OpenbotWorkspaceDirectory = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(1024)),
  path: Path,
  parentPath: Schema.NullOr(Path),
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(Schema.isMaxLength(1024)),
      path: Path,
      kind: Schema.Literals(["file", "directory"]),
      size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      modifiedAt: Schema.Number,
    }),
  ).check(Schema.isMaxLength(500)),
  truncated: Schema.Boolean,
});
export type OpenbotWorkspaceDirectory = typeof OpenbotWorkspaceDirectory.Type;
export const OpenbotConversationFileSearchInput = Schema.Struct({
  hostId: Id,
  query: Schema.String.check(Schema.isMaxLength(255)),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  agentId: Schema.optional(Id),
  taskId: Schema.optional(Id),
});
export type OpenbotConversationFileSearchInput = typeof OpenbotConversationFileSearchInput.Type;
export const OpenbotConversationFilePage = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      agentId: Id,
      messageId: Id,
      taskId: Schema.optional(Id),
      createdAt: Schema.String.check(Schema.isMaxLength(64)),
      attachment: OpenbotFileSummary,
    }),
  ).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
});
export type OpenbotConversationFilePage = typeof OpenbotConversationFilePage.Type;
export const OpenbotFileMaterializeInput = Schema.Struct({
  ...OpenbotFileScope.fields,
  source: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("workspace"), path: Path }),
    Schema.Struct({
      kind: Schema.Literal("attachment"),
      attachmentId: Id,
      messageId: Id,
      taskId: Schema.optional(Id),
    }),
  ]),
});
export type OpenbotFileMaterializeInput = typeof OpenbotFileMaterializeInput.Type;
export const OpenbotMaterializedFile = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isMaxLength(256)),
  name: Name,
  size: Size,
  mimeType: Mime,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type OpenbotMaterializedFile = typeof OpenbotMaterializedFile.Type;
export const OpenbotFileUploadInput = Schema.Struct({
  ...OpenbotFileScope.fields,
  attachmentId: Schema.String.check(Schema.isMaxLength(256)),
  name: Name,
  mimeType: Mime,
  size: Size,
});
export type OpenbotFileUploadInput = typeof OpenbotFileUploadInput.Type;
export const OpenbotDraftFile = Schema.Struct({
  ...OpenbotFileScope.fields,
  attachment: OpenbotFileSummary,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  state: Schema.Literals(["ready", "sending", "sent", "reconciliation-required"]),
  sendText: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100_000))),
  messageId: Schema.NullOr(Id),
  target: Schema.NullOr(OpenbotFileTarget),
  taskId: Schema.NullOr(Id),
});
export type OpenbotDraftFile = typeof OpenbotDraftFile.Type;
export const OpenbotFileSendInput = Schema.Struct({
  ...OpenbotFileScope.fields,
  attachmentId: Id,
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  target: Schema.optional(OpenbotFileTarget),
});
export type OpenbotFileSendInput = typeof OpenbotFileSendInput.Type;
export const OpenbotFileDiscardInput = Schema.Struct({
  ...OpenbotFileScope.fields,
  attachmentId: Id,
});
export type OpenbotFileDiscardInput = typeof OpenbotFileDiscardInput.Type;
export class OpenbotFilesError extends Schema.TaggedError<OpenbotFilesError>()(
  "OpenbotFilesError",
  {
    operation: Schema.Literals(["list", "search", "download", "upload", "send", "discard"]),
    reason: Schema.Literals([
      "transfer",
      "storage",
      "ownership",
      "size",
      "conflict",
      "reconciliation-required",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Bot file ${this.operation} failed (${this.reason}).`;
  }
}
