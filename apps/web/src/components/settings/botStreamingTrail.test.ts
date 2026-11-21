import { describe, expect, it } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { botStreamingTrailPlugin, splitBotStreamingTrail } from "./botStreamingTrail";

describe("OpenBot streaming opacity trail", () => {
  it("keeps a word together when markdown offsets reach into it", () => {
    expect(splitBotStreamingTrail("old newest ", [{ length: 5, revealedAt: 100 }])).toEqual({
      prefix: "old newest",
      chunks: [{ text: " ", revealedAt: 100 }],
    });
    expect(splitBotStreamingTrail("old newest ", [{ length: 7, revealedAt: 100 }])).toEqual({
      prefix: "old ",
      chunks: [{ text: "newest ", revealedAt: 100 }],
    });
  });

  it("renders fading text as inert spans while preserving links and excluding fenced code", async () => {
    const text = "Old [new words](https://example.com)\n\n```js\nconst code = 1;\n```";
    const processor = unified()
      .use(remarkParse)
      .use(botStreamingTrailPlugin(text, [{ length: text.length - 4, revealedAt: 100 }], 140))
      .use(remarkRehype);
    const rendered = await processor.run(processor.parse(text));
    const json = JSON.stringify(rendered);
    expect(json).toContain('"className":["ob-chat-stream-word"]');
    expect(json).toContain('"style":"animation-delay: -40ms"');
    expect(json).toContain('"href":"https://example.com"');
    expect(json).toContain('"value":"const code = 1;\\n"');
    expect(json).not.toContain('"tagName":"em"');
  });
});
