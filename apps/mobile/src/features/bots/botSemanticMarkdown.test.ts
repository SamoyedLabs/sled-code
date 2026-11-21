import { expect, it } from "vite-plus/test";
import { botQuoteReference } from "@t3tools/client-runtime/openbot/presentation";
import { botSemanticMarkdown } from "./botSemanticMarkdown";
import { parseMarkdownDocument } from "../../lib/markdownDocument";
it("retains source quote identity through native Markdown without exposing encoded labels", () => {
  const body = "@[a%0A%5Bpassage%5D%20%F0%9F%98%80](quote+uri:original%29message)";
  const shown = botSemanticMarkdown(body);
  const paragraph = parseMarkdownDocument(shown).children[0];
  if (paragraph?.type !== "paragraph") throw new Error("Missing paragraph");
  const link = paragraph.children[0];
  if (link?.type !== "link") throw new Error("Missing quote link");
  expect(botQuoteReference(link.url)).toEqual({ id: "original)message", text: "a\n[passage] 😀" });
  expect(shown).not.toContain("quote+uri:");
});
it("keeps code and ordinary links literal while displaying source agent and skill names", () => {
  const tag = "@[chosen](quote:original)";
  const code = `\`\`\`text\n${tag}\n\`\`\``;
  const body = `${code}\n\n\`${tag}\`\n\n@[My%20Bot](agent+uri:a) @[Skill](skill:skill-id) [ordinary](quote:original)`;
  const shown = botSemanticMarkdown(body);
  expect(shown).toContain(code);
  expect(shown).toContain(`\`${tag}\``);
  expect(shown).toContain("@My Bot $Skill");
  expect(shown).toContain("[ordinary](quote:original)");
});
