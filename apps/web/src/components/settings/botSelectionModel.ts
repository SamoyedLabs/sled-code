import {
  botFileQuoteId,
  botFileQuoteTarget,
} from "@t3tools/client-runtime/openbot/presentation";
export {
  botFileQuoteId,
  botFileQuoteTarget,
  type BotFileQuoteTarget,
} from "@t3tools/client-runtime/openbot/presentation";
import { serializeBotReference } from "./botComposerModel";

/** Positioning and selection rules translated from upstream SelectionActions.tsx. */
export type SelectionRect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;
export type MessageTextSelection = { messageId: string; text: string; range: Range };
const INTERACTIVE =
  'a, button, input, textarea, select, [contenteditable="true"], [role="button"], .message-citation';
function messageBlock(node: Node) {
  return (
    (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>(
      "[data-selection-message-id], [data-selection-file-quote]",
    ) ?? null
  );
}
export function botMessageTextSelection(
  selection: Selection | null,
  root: HTMLElement,
  includeFiles = false,
): MessageTextSelection | null {
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  const block = messageBlock(range.startContainer);
  if (!block || block !== messageBlock(range.endContainer) || !root.contains(block)) return null;
  if (!includeFiles && block.hasAttribute("data-selection-file-quote")) return null;
  const messageId = block.dataset.selectionMessageId ?? fileSelectionQuoteId(block, range);
  const text = selection
    .toString()
    .replace(/\u00a0/gu, " ")
    .trim();
  if (!messageId || !text) return null;
  for (const element of block.querySelectorAll(INTERACTIVE)) {
    try {
      if (range.intersectsNode(element)) return null;
    } catch {
      /* A detached interactive node cannot intersect the live selection. */
    }
  }
  return { messageId, text, range: range.cloneRange() };
}
export function botSelectionPosition(
  rects: readonly SelectionRect[],
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 8;
  const first = rects[0];
  const last = rects.at(-1);
  if (!first || !last) return { top: margin, left: margin, placement: "bottom" as const };
  const clamp = (value: number, maximum: number) =>
    Math.min(Math.max(value, margin), Math.max(margin, maximum));
  const leftEdge = Math.min(...rects.map((rect) => rect.left));
  const rightEdge = Math.max(...rects.map((rect) => rect.right));
  const left = clamp(
    leftEdge + (rightEdge - leftEdge - toolbar.width) / 2,
    viewport.width - toolbar.width - margin,
  );
  const bottom = last.bottom + gap;
  const top = first.top - gap - toolbar.height;
  const placement =
    bottom + toolbar.height <= viewport.height - margin || top < margin ? "bottom" : "top";
  return {
    top: clamp(placement === "bottom" ? bottom : top, viewport.height - toolbar.height - margin),
    left,
    placement,
  };
}
export function botQuoteShortcut(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "code">,
  mac: boolean,
) {
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.code === "Period"
  );
}
export function limitedBotQuoteText(text: string) {
  return Array.from(text).slice(0, 2000).join("").trimEnd();
}

// OpenBot contracts/selection-instruction.ts: retain the original model-facing instruction body.
export const selectionActionInstructions = {
  Explain: "Explain this selected text.",
  Improve: "Improve this selected text.",
  Shorten: "Shorten this selected text.",
  Tone: "Change the tone of this selected text.",
  Grammar: "Fix the grammar in this selected text.",
} as const;
export function serializeBotSelectionInstruction(instruction: string, quote: string) {
  return `${instruction.trim()}\n\n${quote
    .replace(/\r\n?/gu, "\n")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}

// OpenBot chat-tag-references.ts file passage identities and selection-instruction.ts parsing.
function fileSelectionQuoteId(block: HTMLElement, range: Range) {
  const id = block.dataset.selectionFileQuote;
  const target = id ? botFileQuoteTarget(id) : null;
  if (!id || !target || block.dataset.selectionFileLines !== "true") return id;
  const before = block.ownerDocument.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const selected = range.toString();
  const leading = selected.slice(0, selected.length - selected.trimStart().length);
  const breaks = (text: string) => text.split("\n").length - 1;
  const start = breaks(before.toString()) + breaks(leading) + 1;
  return botFileQuoteId({ ...target, lines: { start, end: start + breaks(selected.trim()) } });
}
export function serializeBotFileSelectionInstruction(
  instruction: string,
  quote: string,
  quoteId: string,
) {
  return `${serializeBotReference("quote", limitedBotQuoteText(quote.trim()), quoteId)}\n\n${instruction.trim()}`;
}
export function parseBotSelectionInstruction(body: string) {
  const separator = body.lastIndexOf("\n\n>");
  if (separator <= 0) return null;
  const instruction = body.slice(0, separator).trim();
  const quoteLines = body.slice(separator + 2).split("\n");
  if (!instruction || !quoteLines.length || quoteLines.some((line) => !/^>(?: |$)/u.test(line)))
    return null;
  const quote = quoteLines
    .map((line) => line.replace(/^> ?/u, ""))
    .join("\n")
    .trim();
  return quote ? { instruction, quote } : null;
}
export function botSelectionSendRequest(
  agentId: string,
  taskId: string | null,
  messageId: string,
  body: string,
  clientMessageId: string,
) {
  const replyToMessageId = botFileQuoteTarget(messageId) ? null : messageId;
  return taskId
    ? replyToMessageId
      ? {
          operation: "thread.reply" as const,
          agentId,
          taskId,
          text: body,
          replyToMessageId,
          attachmentDraftIds: [],
          clientMessageId,
        }
      : { operation: "task.send" as const, agentId, taskId, text: body, clientMessageId }
    : {
        operation: "conversation.send" as const,
        agentId,
        text: body,
        replyToMessageId,
        clientMessageId,
      };
}
