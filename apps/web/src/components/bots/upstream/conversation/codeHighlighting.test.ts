import { expect, it } from "vite-plus/test";
import {
  codeLanguage,
  codeLanguageLabel,
  fileCodeLanguage,
  highlightedCode,
  highlightedCodeLines,
} from "./codeHighlighting";
it("uses the source language aliases and preserves complete code bytes through real tokenization", async () => {
  expect(fileCodeLanguage("nested/Dockerfile")).toBe("docker");
  expect(fileCodeLanguage("notes.tsx")).toBe("ts");
  expect(codeLanguage("unknown-language")).toBe("plain");
  expect(codeLanguageLabel(" swift ")).toBe("SWIFT");
  expect(codeLanguageLabel("mmd")).toBe("Mermaid");
  expect(codeLanguageLabel("")).toBe("Plain text");
  const code = "const answer: number = 42;\n// emoji 😀 and <script> remain text\n";
  const lines = await highlightedCodeLines(code, "ts");
  expect(lines?.map((line) => line.map((token) => token.text).join("")).join("\n")).toBe(code);
  expect(lines?.flat().find((token) => token.text === "const")?.type).toBe("kwd");
});
it("incremental tokenization agrees with a complete pass across multiline strings and embedded HTML", async () => {
  for (const [language, first, final] of [
    [
      "ts",
      "const first = 1;\nconst multi = `open\n",
      "const first = 1;\nconst multi = `open\nclosed`;\nconst answer = 42;\n",
    ],
    [
      "html",
      "<script>\nconst first = 1;\n",
      "<script>\nconst first = 1;\nconst second = 2;\n</script>",
    ],
  ] as const) {
    const previous = await highlightedCode(first, language, undefined);
    const streamed = await highlightedCode(final, language, previous);
    const whole = await highlightedCode(final, language, undefined);
    expect(streamed.lines).toEqual(whole.lines);
  }
});
