import type { Parent } from "mdast";
import { botQuoteHref } from "@t3tools/client-runtime/openbot/presentation";
import { markdownForNativeParsing, parseMarkdownDocument } from "../../lib/markdownDocument";

/** Preserve code literally while adapting source reference tags to native links/chips. */
export function botSemanticMarkdown(input: string) {
  const markdown = markdownForNativeParsing(input);
  const tree = parseMarkdownDocument(markdown);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (parent: Parent) => {
    parent.children.forEach((node, index) => {
      const previous = parent.children[index - 1];
      const match =
        node.type === "link"
          ? /^(quote|agent|skill|mcp)(\+uri)?:([^\r\n]+)$/u.exec(node.url)
          : null;
      if (
        node.type === "link" &&
        match &&
        previous?.type === "text" &&
        previous.value.endsWith("@")
      ) {
        const start = node.position?.start.offset,
          end = node.position?.end.offset;
        if (start === undefined || end === undefined) return;
        const decode = (text: string) => {
          try {
            return match[2] ? decodeURIComponent(text) : text;
          } catch {
            return text;
          }
        };
        const text = decode(
          node.children.map((child) => ("value" in child ? child.value : "")).join(""),
        );
        const id = decode(match[3]!);
        const label = text.replace(/\s+/gu, " ").replace(/[[\]\\]/gu, "\\$&");
        edits.push({
          start: start - 1,
          end,
          text:
            match[1] === "quote"
              ? `[${label}](${botQuoteHref(id, text)})`
              : `${match[1] === "skill" ? "$" : "@"}${label}`,
        });
      } else if ("children" in node) visit(node);
    });
  };
  visit(tree);
  let result = markdown;
  for (const edit of edits.reverse())
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
