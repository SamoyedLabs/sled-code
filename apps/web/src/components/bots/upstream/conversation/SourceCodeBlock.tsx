/* oxlint-disable shadcn/no-unknown-classes -- OpenBot CodeBlock DOM and message-content.css. */
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { namedClipboardTarget, writeTextToClipboard } from "../../../../hooks/useCopyToClipboard";
import {
  codeLanguage,
  codeLanguageLabel,
  highlightedCode,
  plainCodeLines,
  positionedCodeLines,
  reusedCodeLines,
  type HighlightedCode,
} from "./codeHighlighting";
import "./SourceCodeBlock.css";
import { useGT } from "gt-react";

export function SourceCodeBlock({
  code,
  language,
  filename,
  streaming = false,
}: {
  code: string;
  language: string;
  filename?: string | undefined;
  streaming?: boolean | undefined;
}) {
  const gt = useGT();
  const [result, setResult] = useState(() => ({
    language: codeLanguage(language),
    lines: plainCodeLines(code),
  }));
  const [copied, setCopied] = useState(false);
  const highlighted = useRef<HighlightedCode | undefined>(undefined);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selected = codeLanguage(language);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Tokenization is asynchronous and incremental; only complete streamed lines are highlighted and stale tokenizer completions are discarded.
  useEffect(() => {
    let active = true;
    if (highlighted.current?.language !== selected) highlighted.current = undefined;
    const source = streaming ? code.slice(0, code.lastIndexOf("\n") + 1) : code;
    if (selected === "plain" || (streaming && highlighted.current?.code === source)) return;
    void highlightedCode(source, selected, streaming ? highlighted.current : undefined).then(
      (result) => {
        if (!active) return;
        highlighted.current = result;
        setResult((current) => ({
          language: selected,
          lines: reusedCodeLines(code, result.lines, current.lines),
        }));
      },
    );
    return () => {
      active = false;
    };
  }, [code, selected, streaming]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the Copy feedback timeout when this code block leaves the message.
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const shown = positionedCodeLines(
    reusedCodeLines(code, [], result.language === selected ? result.lines : []),
  );
  return (
    <section
      className="message-code-block"
      aria-label={gt("{codeLanguageLabel} code block", {
        codeLanguageLabel: codeLanguageLabel(language),
      })}
    >
      <header className="message-code-header">
        <div className="message-code-heading">
          {filename && <span className="message-code-filename">{filename}</span>}
          <span className="message-code-language">{codeLanguageLabel(language)}</span>
        </div>
        <div className="message-code-actions">
          <button
            type="button"
            className="ui-button message-code-copy"
            aria-label={copied ? gt("Copied code") : gt("Copy code")}
            onClick={() => {
              void writeTextToClipboard(code, namedClipboardTarget("code")).then(
                () => {
                  setCopied(true);
                  clearTimeout(copiedTimer.current);
                  copiedTimer.current = setTimeout(() => setCopied(false), 1500);
                },
                () => setCopied(false),
              );
            }}
          >
            <span className="message-code-copy-icons" aria-hidden="true">
              <span data-visible={!copied || undefined}>
                <CopyIcon />
              </span>
              <span data-visible={copied || undefined}>
                <CheckIcon />
              </span>
            </span>
            <span>{copied ? gt("Copied") : gt("Copy")}</span>
          </button>
        </div>
      </header>
      <pre className="message-code-scroll" tabIndex={0} dir="ltr">
        <code>
          {shown.map((line) => (
            <span key={line.offset} className="message-code-line">
              <span className="message-code-line-number" aria-hidden="true">
                {line.number}
              </span>
              <span className="message-code-line-source">
                {line.tokens.map((token) => (
                  <span key={token.offset} data-code-token={token.type}>
                    {token.text}
                  </span>
                ))}
                {streaming && line.number === shown.length && (
                  <span className="message-code-caret" aria-hidden="true" />
                )}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
