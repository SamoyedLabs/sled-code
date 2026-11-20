type AttachmentSource = {
  agentId: string;
  source: { kind: "attachment"; attachmentId: string; messageId: string; taskId?: string };
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An upstream download carries only an ID. Preserve the observed conversation identity for Sled's guarded materializer. */
export function createAttachmentSources() {
  const sources = new Map<string, Map<string, AttachmentSource>>();
  return {
    remember(snapshot: unknown, agentId: string, taskId?: string) {
      if (!record(snapshot) || !Array.isArray(snapshot.messages)) return;
      for (const message of snapshot.messages) {
        if (
          !record(message) ||
          typeof message.id !== "string" ||
          !Array.isArray(message.attachments)
        )
          continue;
        for (const attachment of message.attachments) {
          if (!record(attachment) || typeof attachment.id !== "string") continue;
          const entry: AttachmentSource = {
            agentId,
            source: {
              kind: "attachment",
              attachmentId: attachment.id,
              messageId: message.id,
              ...(taskId ? { taskId } : {}),
            },
          };
          const variants = sources.get(attachment.id) ?? new Map<string, AttachmentSource>();
          variants.set(JSON.stringify(entry), entry);
          sources.set(attachment.id, variants);
          if (sources.size > 1000) sources.delete(sources.keys().next().value!);
        }
      }
    },
    get(attachmentId: string): AttachmentSource {
      const variants = sources.get(attachmentId);
      if (!variants || variants.size !== 1)
        throw new Error(
          "Open this file from its original conversation; its message identity is unavailable or ambiguous.",
        );
      return variants.values().next().value!;
    },
    clear() {
      sources.clear();
    },
  };
}
