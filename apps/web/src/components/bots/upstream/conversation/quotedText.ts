import type { BotFileQuoteTarget } from "../../../settings/botSelectionModel";

export function botQuotedTextRange(
  block: HTMLElement,
  text: string,
  lines: BotFileQuoteTarget["lines"],
): Range | null {
  const lineStart =
    lines && block.dataset.selectionFileLines === "true"
      ? sourceLineOffset(block.textContent ?? "", lines.start)
      : 0;
  for (const kept of [/\S/u, /[\p{L}\p{N}]/u]) {
    const range = compactTextRange(block, text, kept, lineStart);
    if (range) return range;
  }
  return null;
}

function compactTextRange(
  block: HTMLElement,
  text: string,
  kept: RegExp,
  lineStart: number,
): Range | null {
  const wanted = Array.from(text)
    .filter((character) => kept.test(character))
    .join("");
  if (!wanted) return null;
  const nodes: Text[] = [];
  const positions: Array<{ node: number; offset: number; source: number }> = [];
  let compact = "";
  let source = 0;
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      !(node instanceof Text) ||
      node.parentElement?.closest('button, [aria-hidden="true"], .message-code-header')
    )
      continue;
    const value = node.data;
    nodes.push(node);
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset] ?? "";
      if (kept.test(character)) {
        compact += character;
        positions.push({ node: nodes.length - 1, offset, source: source + offset });
      }
    }
    source += value.length;
  }
  const from = Math.max(
    0,
    positions.findIndex((position) => position.source >= lineStart),
  );
  const atLines = compact.indexOf(wanted, from);
  const index = atLines >= 0 ? atLines : compact.indexOf(wanted);
  const first = positions[index];
  const last = positions[index + wanted.length - 1];
  const startNode = first ? nodes[first.node] : undefined;
  const endNode = last ? nodes[last.node] : undefined;
  if (index < 0 || !first || !last || !startNode || !endNode) return null;
  const range = block.ownerDocument.createRange();
  range.setStart(startNode, first.offset);
  range.setEnd(endNode, last.offset + 1);
  return range;
}

function sourceLineOffset(source: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf("\n", offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  return offset;
}

/** Keep a quote marked through async file loading and tokenizer node replacement, until pointer/Escape. */
export function watchBotQuotedText(
  root: HTMLElement,
  selector: string,
  text: string,
  lines?: BotFileQuoteTarget["lines"],
) {
  const name = "openbot-quote-target";
  let highlight: Highlight | null = null;
  let marked: Range | null = null;
  let searched: HTMLElement | null = null;
  const release = new AbortController();
  const clear = () => {
    if (highlight && CSS.highlights?.get(name) === highlight) CSS.highlights.delete(name);
  };
  const show = (records: MutationRecord[] = []) => {
    if (marked && !marked.collapsed) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const block of blocks) {
      if (block === searched && !records.some((record) => block.contains(record.target))) continue;
      searched = block;
      const range = botQuotedTextRange(block, text, lines);
      if (!range) continue;
      clear();
      if (typeof Highlight !== "undefined" && CSS.highlights) {
        highlight = new Highlight(range);
        CSS.highlights.set(name, highlight);
      }
      if (!marked)
        (range.startContainer.parentElement ?? block).scrollIntoView({
          behavior: "auto",
          block: "center",
          inline: "nearest",
        });
      marked = range;
      break;
    }
  };
  const observer = new MutationObserver(show);
  const stop = () => {
    observer.disconnect();
    release.abort();
    clear();
  };
  show();
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  const view = root.ownerDocument.defaultView;
  view?.addEventListener("pointerdown", stop, { signal: release.signal });
  view?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") stop();
    },
    { signal: release.signal },
  );
  return stop;
}
