import { useEffect, useState } from "react";
import {
  fileCodeLanguage,
  highlightedCodeLines,
  positionedCodeLines,
  type CodeToken,
} from "./codeHighlighting";
import "./SourceCodeBlock.css";
export function SourceFileText({
  name,
  text,
  wrap,
  quoteId,
}: {
  name: string;
  text: string;
  wrap: boolean;
  quoteId?: string | undefined;
}) {
  const [result, setResult] = useState<{
    text: string;
    language: string;
    tokens: CodeToken[];
  } | null>(null);
  const language = fileCodeLanguage(name);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Run the source tokenizer with its original size/line bounds; a replaced file cannot receive an earlier tokenization result.
  useEffect(() => {
    if (
      language === "plain" ||
      text.length > 200000 ||
      text.split("\n").some((line) => line.length > 5000)
    )
      return;
    let current = true;
    void highlightedCodeLines(text, language).then((lines) => {
      if (current && lines)
        setResult({
          text,
          language,
          tokens: lines.flatMap((line, index) => (index ? [{ text: "\n" }, ...line] : line)),
        });
    });
    return () => {
      current = false;
    };
  }, [text, language]);
  const tokens = result?.text === text && result.language === language ? result.tokens : null;
  return (
    <pre
      className={`file-preview-text${wrap ? " file-preview-text-wrap" : ""}`}
      data-selection-file-quote={quoteId}
      data-selection-file-lines={quoteId ? "true" : undefined}
    >
      {tokens
        ? positionedCodeLines([tokens])[0]!.tokens.map((token) => (
            <span key={token.offset} data-code-token={token.type}>
              {token.text}
            </span>
          ))
        : text}
    </pre>
  );
}
