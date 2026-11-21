import * as Schema from "effect/Schema";

export const OPENBOT_LIBRARY_FOLDERS_CAPABILITY = "library-folders-v1";
export const OPENBOT_LIBRARY_EVENTS_CAPABILITY = "library-folders-events-v1";
export const OPENBOT_LIBRARY_STORAGE_CAPABILITY = "storage-v1";
export const OPENBOT_LIBRARY_ROUTES = {
  read: "/v1/library-folders",
  change: "/v1/library-folders/actions",
  files: "/v1/storage/usage",
  deleteFile: "/v1/storage/delete-file",
} as const;

const text = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));
const id = text(128).check(Schema.isMinLength(1));
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const name = text(80).check(Schema.isMinLength(1));
const folder = Schema.Struct({
  id,
  agentId: id,
  name,
  parentId: Schema.optionalKey(id),
});
const fileIds = Schema.Array(id).check(Schema.isMaxLength(2_000));
const placement = Schema.Record(id, id).check(
  Schema.makeFilter((value) => Object.keys(value).length <= 20_000),
);
export const OpenbotLibraryFolders = Schema.Struct({
  revision: count,
  folders: Schema.Array(folder).check(Schema.isMaxLength(500)),
  placement,
});
export type OpenbotLibraryFolders = typeof OpenbotLibraryFolders.Type;

export const OpenbotLibraryAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("create"),
    id,
    agentId: id,
    name,
    parentId: Schema.optionalKey(id),
    fileIds: Schema.optionalKey(fileIds),
  }),
  Schema.Struct({ type: Schema.Literal("rename"), folderId: id, name }),
  Schema.Struct({ type: Schema.Literal("delete"), folderId: id }),
  Schema.Struct({
    type: Schema.Literal("move"),
    folderId: id,
    parentId: Schema.NullOr(id),
    beforeFolderId: Schema.NullOr(id),
  }),
  Schema.Struct({ type: Schema.Literal("place"), fileIds, folderId: Schema.NullOr(id) }),
  Schema.Struct({
    type: Schema.Literal("restore"),
    folders: Schema.Array(Schema.Struct({ index: count, folder })).check(Schema.isMaxLength(500)),
    placement,
  }),
]);
export type OpenbotLibraryAction = typeof OpenbotLibraryAction.Type;

export const OpenbotLibraryFile = Schema.Struct({
  id,
  name: text(255),
  size: count,
  kind: Schema.Literals(["image", "file"]),
  mimeType: text(255),
  previewKind: Schema.Literals(["image", "pdf", "text", "none"]),
  source: Schema.Literals(["attachment", "generated"]),
  agentId: Schema.NullOr(id),
  conversation: Schema.NullOr(Schema.Struct({ id, title: text(255) })),
  messageId: Schema.NullOr(id),
  createdAt: text(64),
  status: Schema.Literals(["available", "missing"]),
  deletable: Schema.Boolean,
});
export type OpenbotLibraryFile = typeof OpenbotLibraryFile.Type;
export const OpenbotLibraryFiles = Schema.Struct({
  files: Schema.Array(OpenbotLibraryFile).check(Schema.isMaxLength(2_000)),
  scannedAt: text(64),
  truncated: Schema.Boolean,
});
export type OpenbotLibraryFiles = typeof OpenbotLibraryFiles.Type;

export const OpenbotLibraryReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("library.folders.read") }),
  Schema.Struct({
    operation: Schema.Literal("library.files.list"),
    force: Schema.optionalKey(Schema.Boolean),
  }),
]);
export type OpenbotLibraryReadRequest = typeof OpenbotLibraryReadRequest.Type;
export const OpenbotLibraryAdminRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("library.folders.change"),
    action: OpenbotLibraryAction,
  }),
  Schema.Struct({ operation: Schema.Literal("library.files.delete"), fileId: id }),
]);
export type OpenbotLibraryAdminRequest = typeof OpenbotLibraryAdminRequest.Type;

// Keep automatic in-grid previews within one bounded RPC response; originals use the file viewer.
export const OPENBOT_LIBRARY_PREVIEW_LIMIT = 768 * 1024;
export const OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT = 10 * 1024 * 1024;
export const OpenbotLibraryPictureMime = Schema.Literals([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
export const OpenbotLibraryPreviewRequest = Schema.Struct({
  operation: Schema.Literal("library.files.preview"),
  fileId: id,
  conversationId: Schema.optionalKey(id),
});
export type OpenbotLibraryPreviewRequest = typeof OpenbotLibraryPreviewRequest.Type;
export const OpenbotLibraryPicture = Schema.Struct({
  mimeType: OpenbotLibraryPictureMime,
  base64: text(4 * Math.ceil(OPENBOT_LIBRARY_PREVIEW_LIMIT / 3)).check(
    Schema.isMinLength(4),
    Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u),
  ),
});
