import * as Schema from "effect/Schema";
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Id = Schema.NonEmptyString;
export const StoredFileRow = Schema.Struct({
  id: Id,
  name: Schema.String,
  size: Count,
  kind: Schema.Literals(["image", "file"]),
  mimeType: Schema.String,
  previewKind: Schema.Literals(["image", "pdf", "text", "none"]),
  previewUrl: Schema.NullOr(Schema.String),
  source: Schema.Literals(["attachment", "generated", "workspace", "download"]),
  agentId: Schema.NullOr(Id),
  conversation: Schema.NullOr(Schema.Struct({ id: Id, title: Schema.String })),
  messageId: Schema.NullOr(Id),
  createdAt: Schema.String,
  status: Schema.Literals(["available", "missing", "remote", "failed"]),
  deletable: Schema.Boolean,
});
export type StoredFileRow = typeof StoredFileRow.Type;
export const StorageBreakdown = Schema.Struct({
  category: Schema.Literals([
    "workspaces",
    "attachments",
    "generated",
    "chats",
    "downloads",
    "caches",
    "runtimes",
    "logs",
  ]),
  bytes: Count,
  removable: Schema.Boolean,
});
export type StorageBreakdown = typeof StorageBreakdown.Type;
export type StorageCategory = StorageBreakdown["category"];
const ConversationStorageRow = Schema.Struct({
  id: Id,
  title: Schema.String,
  agentId: Id,
  bytes: Count,
  fileCount: Count,
  messageCount: Count,
});
export type ConversationStorageRow = typeof ConversationStorageRow.Type;
export const StorageUsage = Schema.Struct({
  scope: Schema.Literals(["host", "agent", "conversation"]),
  agentId: Schema.NullOr(Id),
  conversationId: Schema.NullOr(Id),
  scannedAt: Schema.String,
  freeBytes: Schema.NullOr(Count),
  breakdown: Schema.Array(StorageBreakdown),
  agents: Schema.Array(
    Schema.Struct({ agentId: Id, bytes: Count, fileCount: Count, conversationCount: Count }),
  ),
  conversations: Schema.Array(ConversationStorageRow),
  files: Schema.Array(StoredFileRow),
  truncated: Schema.Boolean,
});
export type StorageUsage = typeof StorageUsage.Type;
export const readStorageUsage = Schema.decodeUnknownSync(StorageUsage);
