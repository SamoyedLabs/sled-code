const PREFIX = "#openbot-quote=";
export function botQuoteHref(id: string, text: string) {
  return `${PREFIX}${encodeURIComponent(JSON.stringify({ id, text })).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
export function botQuoteReference(href: string): { id: string; text: string } | null {
  if (!href.startsWith(PREFIX) || href.length > 100000) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(href.slice(PREFIX.length)));
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "text" in value &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      typeof value.text === "string" &&
      value.text.length > 0
    )
      return { id: value.id, text: value.text };
  } catch {
    /* An incomplete tag stays ordinary Markdown. */
  }
  return null;
}

export type BotFileQuoteTarget = (
  | { source: "workspace" | "shared"; path: string }
  | { source: "attachment"; attachmentId: string; name: string }
) & { lines?: { start: number; end: number } | undefined };
export function botFileQuoteId(target: BotFileQuoteTarget) {
  const lines = target.lines;
  const suffix = !lines
    ? ""
    : lines.end > lines.start
      ? `#L${lines.start}-${lines.end}`
      : `#L${lines.start}`;
  const file =
    target.source === "attachment" ? `${target.attachmentId}/${target.name}` : target.path;
  return `${target.source}-file:${file}${suffix}`;
}
export function botFileQuoteTarget(id: string): BotFileQuoteTarget | null {
  const match = /^(workspace|shared|attachment)-file:(.+?)(?:#L(\d+)(?:-(\d+))?)?$/u.exec(id);
  const file = match?.[2];
  if (!match || !file) return null;
  const start = Number(match[3]);
  const lines =
    match[3] && start >= 1 ? { start, end: Math.max(start, Number(match[4] ?? start)) } : undefined;
  if (match[1] !== "attachment")
    return { source: match[1] === "shared" ? "shared" : "workspace", path: file, lines };
  const slash = file.indexOf("/");
  if (slash < 1 || slash === file.length - 1) return null;
  return {
    source: "attachment",
    attachmentId: file.slice(0, slash),
    name: file.slice(slash + 1),
    lines,
  };
}

export function resolveBotQuotedFileSource(
  target: BotFileQuoteTarget,
  messages: readonly { id: string; attachments?: unknown }[],
  taskId: string | null,
): import("@t3tools/contracts").OpenbotAgentFileSource | null {
  if (target.source !== "attachment") return { kind: target.source, path: target.path };
  const message = messages.find(
    (message) =>
      Array.isArray(message.attachments) &&
      message.attachments.some(
        (file: unknown) =>
          typeof file === "object" &&
          file !== null &&
          "id" in file &&
          file.id === target.attachmentId,
      ),
  );
  return message
    ? {
        kind: "attachment",
        attachmentId: target.attachmentId,
        messageId: message.id,
        ...(taskId ? { taskId } : {}),
      }
    : null;
}
