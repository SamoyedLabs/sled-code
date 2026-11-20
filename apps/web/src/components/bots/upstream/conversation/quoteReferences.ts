import type { Parent, Root } from "mdast";
import type { Plugin } from "unified";

import { botQuoteHref } from "@t3tools/client-runtime/openbot/presentation";
export { botQuoteHref, botQuoteReference } from "@t3tools/client-runtime/openbot/presentation";

// Source semanticChatTag: a quote is a link immediately preceded by @, never code or an ordinary link.
export const botQuoteReferencesPlugin: Plugin<[], Root> = () => (tree) => {
  const visit = (parent: Parent) => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const node = parent.children[index];
      if (!node) continue;
      const previous = parent.children[index - 1];
      const match = node.type === "link" ? /^(quote)(\+uri)?:([^\r\n]+)$/u.exec(node.url) : null;
      if (
        node.type === "link" &&
        match &&
        previous?.type === "text" &&
        previous.value.endsWith("@")
      ) {
        const decode = (value: string) => {
          try {
            return match[2] ? decodeURIComponent(value) : value;
          } catch {
            return value;
          }
        };
        const text = decode(
          node.children.map((child) => ("value" in child ? child.value : "")).join(""),
        );
        const id = decode(match[3]!);
        if (id && text) {
          previous.value = previous.value.slice(0, -1);
          node.url = botQuoteHref(id, text);
          node.children = [{ type: "text", value: text }];
        }
      } else if ("children" in node) visit(node);
    }
  };
  visit(tree);
};
