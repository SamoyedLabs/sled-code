import { expect, it } from "vite-plus/test";
import { botReplyParts } from "./bot-reply-previews";
import { chatHtmlPreviewDocument } from "./upstream/openbot-mobile/chat-preview/chat-preview";

it("splits visual reply blocks in order without converting ordinary code or user text", () => {
  const body = [
    "Before <b>this</b>",
    "",
    "```HTML",
    "<h1>Demo</h1>",
    "```",
    "",
    "```ts",
    "const test = 1",
    "```",
    "",
    "~~~mmd",
    "flowchart LR",
    "A --> B",
    "~~~",
    "",
    "After",
  ].join("\n");
  expect(botReplyParts(body, true).map(({ type, body }) => [type, body])).toEqual([
    ["markdown", "Before <b>this</b>"],
    ["preview", "<h1>Demo</h1>"],
    ["markdown", "```ts\nconst test = 1\n```"],
    ["preview", "flowchart LR\nA --> B"],
    ["markdown", "After"],
  ]);
  expect(botReplyParts(body, false)).toEqual([{ type: "markdown", body, start: 0 }]);
});

it("uses the bounded excerpt path for a partial visual fence and protects the preview document", () => {
  expect(botReplyParts("~~~html\n<h1>Typing", true)[0]).toMatchObject({
    type: "preview",
    kind: "html",
  });
  const source = '<meta http-equiv="Content-Security-Policy" content="default-src *">';
  const markup = chatHtmlPreviewDocument(source);
  expect(markup.indexOf("default-src 'none'")).toBeLessThan(markup.indexOf(source));
  expect(markup).toContain("form-action 'none'");
  expect(markup).toContain("base-uri 'none'");
});
