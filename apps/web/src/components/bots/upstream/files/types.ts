export {
  StoredFileRow,
  StorageBreakdown,
  StorageUsage,
  readStorageUsage,
  type StorageCategory,
  type ConversationStorageRow,
} from "@t3tools/client-runtime/openbot/storage";
import type { StoredFileRow } from "@t3tools/client-runtime/openbot/storage";

export type StoredFileAction = "open" | "reveal" | "download" | "show-in-chat" | "delete" | "retry";
export const canPreviewAttachment = (file: Pick<StoredFileRow, "previewKind">) =>
  file.previewKind !== "none";
