import { OPENBOT_MAX_FILE_BYTES } from "@t3tools/contracts";

// OpenBot iOS 1.4.11 downloads attachments over 10 MiB only on demand by default.
export const BOT_LARGE_FILE_BYTES = 10 * 1024 * 1024;

export function botAttachmentDownload(size: number | undefined) {
  if (size === undefined || size <= BOT_LARGE_FILE_BYTES) return "standard";
  return size <= OPENBOT_MAX_FILE_BYTES ? "large" : "desktop";
}

export function botChatAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  const files = new Map<string, { id: string; name: string; size?: number }>();
  for (const entry of value) {
    if (typeof entry?.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name)
      continue;
    const size =
      typeof entry.size === "number" && Number.isSafeInteger(entry.size) && entry.size >= 0
        ? entry.size
        : undefined;
    files.set(entry.id, {
      id: entry.id,
      name: entry.name,
      ...(size === undefined ? {} : { size }),
    });
  }
  return [...files.values()];
}

export function firstLargeBotAttachment(value: unknown) {
  return botChatAttachments(value).find(({ size }) => botAttachmentDownload(size) === "large");
}
