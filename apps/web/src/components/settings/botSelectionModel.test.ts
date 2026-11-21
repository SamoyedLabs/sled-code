import { describe, expect, it } from "vite-plus/test";
import {
  botQuoteShortcut,
  botSelectionPosition,
  limitedBotQuoteText,
  botFileQuoteId,
  botFileQuoteTarget,
  serializeBotFileSelectionInstruction,
  botSelectionSendRequest,
  parseBotSelectionInstruction,
} from "./botSelectionModel";
import { serializeBotReference, botComposerContent } from "./botComposerModel";
const rect = { top: 100, left: 100, right: 300, bottom: 120, width: 200, height: 20 };
describe("source selection quote behavior", () => {
  it("prefers below the passage, flips above near the viewport bottom, and clamps within 12px", () => {
    expect(
      botSelectionPosition([rect], { width: 84, height: 36 }, { width: 500, height: 500 }),
    ).toEqual({ left: 158, top: 128, placement: "bottom" });
    expect(
      botSelectionPosition(
        [{ ...rect, top: 440, bottom: 460 }],
        { width: 84, height: 36 },
        { width: 500, height: 500 },
      ),
    ).toEqual({ left: 158, top: 396, placement: "top" });
    expect(
      botSelectionPosition(
        [{ ...rect, left: -30, right: 10 }],
        { width: 84, height: 36 },
        { width: 60, height: 40 },
      ),
    ).toEqual({ left: 12, top: 12, placement: "top" });
  });
  it("uses the source platform quote chord and excludes mixed modifiers", () => {
    const chord = { metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, code: "Period" };
    expect(botQuoteShortcut(chord, true)).toBe(true);
    expect(botQuoteShortcut(chord, false)).toBe(false);
    expect(botQuoteShortcut({ ...chord, metaKey: false, ctrlKey: true }, false)).toBe(true);
    for (const changed of [
      { altKey: true },
      { ctrlKey: true },
      { shiftKey: false },
      { code: "Comma" },
    ])
      expect(botQuoteShortcut({ ...chord, ...changed }, true)).toBe(false);
  });
  it("bounds quoted code points without splitting emoji and preserves message identity through serialization", () => {
    const text = limitedBotQuoteText("😀".repeat(2001));
    expect(Array.from(text)).toHaveLength(2000);
    expect(text.endsWith("😀")).toBe(true);
    const token = serializeBotReference("quote", "a\n<script> [quoted] 😀", "message)id");
    expect(botComposerContent(token).content?.[0]?.content?.[0]?.attrs).toEqual({
      kind: "quote",
      name: "a\n<script> [quoted] 😀",
      id: "message)id",
    });
  });
});

describe("source selection instruction wire behavior", () => {
  it("retains exact file paths, names and line ranges, including encoded unsafe quote content", () => {
    const id = botFileQuoteId({
      source: "attachment",
      attachmentId: "original-upload",
      name: "notes.md",
      lines: { start: 3, end: 5 },
    });
    expect(id).toBe("attachment-file:original-upload/notes.md#L3-5");
    expect(botFileQuoteTarget(id)).toEqual({
      source: "attachment",
      attachmentId: "original-upload",
      name: "notes.md",
      lines: { start: 3, end: 5 },
    });
    const body = serializeBotFileSelectionInstruction(
      " Explain this selected text. ",
      "a\n[unsafe]",
      id,
    );
    const reference = botComposerContent(body).content?.[0]?.content?.[0];
    expect(reference?.attrs).toEqual({ kind: "quote", name: "a\n[unsafe]", id });
    expect(body.endsWith("\n\nExplain this selected text.")).toBe(true);
    expect(botFileQuoteTarget("ordinary-message")).toBeNull();
    expect(botFileQuoteTarget("attachment-file:/missing-owner.md")).toBeNull();
  });
  it("sends file passages without a message reply, for both main and task, preserving attempt identity", () => {
    for (const taskId of [null, "original-task"]) {
      const file = botSelectionSendRequest(
        "agent",
        taskId,
        "workspace-file:src/a.ts#L2",
        "body",
        "attempt",
      );
      expect(file).toMatchObject({
        operation: taskId ? "task.send" : "conversation.send",
        agentId: "agent",
        text: "body",
        clientMessageId: "attempt",
      });
      expect(file.replyToMessageId ?? null).toBeNull();
      expect(
        botSelectionSendRequest("agent", taskId, "message", "body", "attempt").replyToMessageId,
      ).toBe("message");
    }
  });
  it("parses only a complete trailing quote, leaving unrelated Markdown unchanged", () => {
    expect(
      parseBotSelectionInstruction("Improve this selected text.\n\n> first\n> \n> third"),
    ).toEqual({ instruction: "Improve this selected text.", quote: "first\n\nthird" });
    for (const body of [
      "ordinary",
      "> quote",
      "Explain\n\n> quote\nunquoted tail",
      "Explain\n\n> ",
      "\n\n> quote",
    ])
      expect(parseBotSelectionInstruction(body)).toBeNull();
  });
});
