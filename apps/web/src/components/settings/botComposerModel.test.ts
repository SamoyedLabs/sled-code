import { describe, expect, it } from "vite-plus/test";
import { Schema } from "@tiptap/pm/model";
import {
  botComposerContent,
  botComposerText,
  botMentionAtCaret,
  rankBotComposerOptions,
  serializeBotReference,
} from "./botComposerModel";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    hardBreak: { inline: true, group: "inline" },
    botReference: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { kind: {}, name: {}, id: {} },
    },
  },
});

describe("OpenBot composer identity projection", () => {
  it("round trips multiline drafts with ambiguous names and IDs without changing their identities", () => {
    const references = [
      serializeBotReference("agent", "Design ] team", "agent)id"),
      serializeBotReference("skill", "Résumé review", "skill/one"),
      serializeBotReference("attachment", "brief.md", "file-1"),
    ];
    const text = `Ask ${references[0]}\nUse ${references[1]} with ${references[2]}\n`;
    const doc = schema.nodeFromJSON(botComposerContent(text));
    expect(botComposerText(doc)).toBe(text);
    const atoms: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === "botReference") atoms.push(node.attrs.id);
    });
    expect(atoms).toEqual(["agent)id", "skill/one", "file-1"]);
  });

  it("preserves pasted markup as plain text and retains an unknown reference", () => {
    const text = "<script>alert(1)</script> **literal**\n@[Gone](skill:removed)";
    expect(botComposerText(schema.nodeFromJSON(botComposerContent(text)))).toBe(text);
  });

  it("opens mentions only at a boundary and does not cross an atomic reference or newline", () => {
    expect(botMentionAtCaret("mail@example.com")).toBeNull();
    expect(botMentionAtCaret("Ask @Design team")).toEqual({
      query: "Design team",
      start: 4,
      end: 16,
      trigger: "@",
    });
    expect(botMentionAtCaret("@Design\nteam")).toBeNull();
    expect(botMentionAtCaret("@Design\uFFFCteam")).toBeNull();
  });

  it("ranks the named bot ahead of a description match, including diacritics", () => {
    const options = [
      {
        kind: "agent" as const,
        id: "first",
        name: "Research",
        description: "Works with Elena",
        badge: "Agent",
      },
      { kind: "agent" as const, id: "second", name: "Éléna", badge: "Agent" },
    ];
    expect(rankBotComposerOptions(options, "elena").map((option) => option.id)).toEqual([
      "second",
      "first",
    ]);
  });
});
