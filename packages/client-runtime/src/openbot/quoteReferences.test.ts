import { expect, it } from "vite-plus/test";
import {
  botFileQuoteTarget,
  resolveBotQuotedFileSource,
  botQuoteHref,
  botQuoteReference,
} from "./quoteReferences.js";
it("opens only an original attachment present in the conversation and retains its task authority", () => {
  const target = botFileQuoteTarget("attachment-file:original-file/notes.md#L2-4");
  if (!target) throw new Error("Missing target");
  expect(
    resolveBotQuotedFileSource(
      target,
      [{ id: "other-message", attachments: [{ id: "other-file" }] }],
      "task",
    ),
  ).toBeNull();
  expect(
    resolveBotQuotedFileSource(
      target,
      [{ id: "original-message", attachments: [{ id: "original-file" }] }],
      "task",
    ),
  ).toEqual({
    kind: "attachment",
    attachmentId: "original-file",
    messageId: "original-message",
    taskId: "task",
  });
  expect(
    resolveBotQuotedFileSource({ source: "shared", path: "Shared/notes.md" }, [], null),
  ).toEqual({ kind: "shared", path: "Shared/notes.md" });
});
it("round-trips Unicode and Markdown delimiters without executable URLs", () => {
  const value = { id: "file(id)'", text: "a\n<script>[😀]" };
  const href = botQuoteHref(value.id, value.text);
  expect(href).not.toMatch(/[()']/u);
  expect(botQuoteReference(href)).toEqual(value);
  for (const invalid of [
    "https://example.test",
    "#openbot-quote=%",
    "#openbot-quote=%7B%7D",
    "#openbot-quote=%22text%22",
  ])
    expect(botQuoteReference(invalid)).toBeNull();
});
