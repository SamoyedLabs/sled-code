import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type BotReferenceKind = "agent" | "skill" | "mcp" | "attachment" | "quote";
export type BotComposerOption = {
  kind: BotReferenceKind;
  id: string;
  name: string;
  description?: string | undefined;
  slug?: string;
  badge: string;
  seed?: string;
  hue?: number | null | undefined;
};

// OpenBot chat-tag-references.ts wire format, including names/IDs needing URI escaping.
export function serializeBotReference(kind: BotReferenceKind, name: string, id: string) {
  if (kind === "attachment")
    return `@[${name.replace(/[\]\r\n]+/gu, " ").trim() || "file"}](attachment:${id.replace(/[)\r\n]+/gu, "").trim()})`;
  const unsafe = kind === "quote" ? /[[\]\\`<\r\n]/u : /[\]\r\n]/u;
  if (name && id && !unsafe.test(name) && !/[)\r\n]/u.test(id)) return `@[${name}](${kind}:${id})`;
  const encode = (text: string) =>
    encodeURIComponent(text).replace(
      /[!'()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  return `@[${encode(name)}](${kind}+uri:${encode(id)})`;
}

export function botComposerContent(value: string): JSONContent {
  const content: JSONContent[] = [];
  const appendText = (text: string) =>
    text.split("\n").forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
  let cursor = 0;
  for (const match of value.matchAll(
    /@\[([^\]\r\n]+)\]\((agent|skill|mcp|attachment|quote)(\+uri)?:([^)\r\n]+)\)/gu,
  )) {
    appendText(value.slice(cursor, match.index));
    const decode = (value: string) => {
      if (!match[3]) return value;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    content.push({
      type: "botReference",
      attrs: { kind: match[2], name: decode(match[1]!), id: decode(match[4]!) },
    });
    cursor = match.index + match[0].length;
  }
  appendText(value.slice(cursor));
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function botComposerText(doc: ProseMirrorNode): string {
  const blocks: string[] = [];
  doc.forEach((block) => {
    let text = "";
    block.descendants((node) => {
      if (node.isText) text += node.text ?? "";
      else if (node.type.name === "hardBreak") text += "\n";
      else if (node.type.name === "botReference")
        text += serializeBotReference(node.attrs.kind, node.attrs.name, node.attrs.id);
    });
    blocks.push(text);
  });
  return blocks.join("\n");
}

/** Source ComposerEditor.mentionAtSelection: a trigger starts at a word boundary. */
export function botMentionAtCaret(beforeCaret: string) {
  const match = beforeCaret.match(/(?:^|\s)([@$])([^@$\n\uFFFC]{0,60})$/u);
  if (!match) return null;
  const query = match[2] ?? "";
  return {
    query,
    start: beforeCaret.length - query.length - 1,
    end: beforeCaret.length,
    trigger: match[1] as "@" | "$",
  };
}

/** Source composer-picker.skillMatchRank and agent-mention-rank.agentMentionRank. */
export function rankBotComposerOptions(options: readonly BotComposerOption[], query: string) {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  return options
    .flatMap((option) => {
      const normalize = option.kind === "agent" ? fold : (text: string) => text.toLocaleLowerCase();
      const needle = normalize(query.trim());
      const name = normalize(option.name);
      const slug = normalize(option.slug ?? "");
      const description = normalize(option.description ?? "");
      const rank =
        !needle || name === needle || slug === needle
          ? 0
          : name.startsWith(needle) || slug.startsWith(needle)
            ? 1
            : name.split(/[\s\-_]+/u).some((word) => word.startsWith(needle))
              ? 2
              : name.includes(needle) || slug.includes(needle)
                ? 3
                : description.includes(needle)
                  ? 4
                  : null;
      return rank === null ? [] : [{ option, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ option }) => option);
}
