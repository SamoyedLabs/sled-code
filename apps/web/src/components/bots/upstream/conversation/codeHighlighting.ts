import { type ShjLanguage, type ShjToken, tokenize } from "@speed-highlight/core";

export interface CodeToken {
  text: string;
  type?: ShjToken | undefined;
}

export type CodeLine = CodeToken[];

export interface HighlightedCode {
  /** The highlighted source. While the block streams, this ends at its last line break. */
  code: string;
  language: ShjLanguage;
  lines: CodeLine[];
  /** For each line start, whether the tokenizer had no open token there, so it can start again there. */
  restarts: boolean[];
}

const LANGUAGE_ALIASES: Record<string, ShjLanguage> = {
  assembly: "asm",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  cpp: "c",
  cxx: "c",
  dockerfile: "docker",
  golang: "go",
  htaccess: "http",
  htm: "html",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  makefile: "make",
  markdown: "md",
  mts: "ts",
  cts: "ts",
  patch: "diff",
  perl: "pl",
  plaintext: "plain",
  text: "plain",
  txt: "plain",
  python: "py",
  rust: "rs",
  scss: "css",
  typescript: "ts",
  tsx: "ts",
  svg: "xml",
  yml: "yaml",
};

const SUPPORTED_LANGUAGES = new Set<string>([
  "asm",
  "bash",
  "bf",
  "c",
  "css",
  "csv",
  "diff",
  "docker",
  "git",
  "go",
  "html",
  "http",
  "ini",
  "java",
  "js",
  "jsdoc",
  "json",
  "leanpub-md",
  "log",
  "lua",
  "make",
  "md",
  "pl",
  "plain",
  "py",
  "regex",
  "rs",
  "sql",
  "todo",
  "toml",
  "ts",
  "uri",
  "xml",
  "yaml",
]);

const LANGUAGE_LABELS: Partial<Record<ShjLanguage, string>> = {
  c: "C",
  css: "CSS",
  csv: "CSV",
  docker: "Dockerfile",
  go: "Go",
  html: "HTML",
  http: "HTTP",
  ini: "INI",
  java: "Java",
  js: "JavaScript",
  jsdoc: "JSDoc",
  json: "JSON",
  lua: "Lua",
  make: "Makefile",
  md: "Markdown",
  py: "Python",
  rs: "Rust",
  sql: "SQL",
  toml: "TOML",
  ts: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

export function codeLanguage(language: string): ShjLanguage {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return "plain";
  const alias = Object.hasOwn(LANGUAGE_ALIASES, normalized)
    ? LANGUAGE_ALIASES[normalized]
    : undefined;
  if (alias) return alias;
  return isSupportedLanguage(normalized) ? normalized : "plain";
}

/** The language of a file from its extension, or from its whole name when it has none, such as `Dockerfile`. */
export function fileCodeLanguage(name: string): ShjLanguage {
  const fileName = name.slice(name.lastIndexOf("/") + 1);
  const extensionStart = fileName.lastIndexOf(".");
  return codeLanguage(extensionStart > 0 ? fileName.slice(extensionStart + 1) : fileName);
}

/** The highlighted lines of complete code, or `undefined` when the tokenizer fails. */
export async function highlightedCodeLines(
  code: string,
  language: ShjLanguage,
): Promise<CodeLine[] | undefined> {
  return (await tokenizedCode(code, language))?.lines;
}

function isSupportedLanguage(language: string): language is ShjLanguage {
  return SUPPORTED_LANGUAGES.has(language);
}

export function plainCodeLines(code: string): CodeLine[] {
  return code.split("\n").map((line) => [{ text: line }]);
}

function codeLineText(line: CodeLine | undefined): string | undefined {
  return line?.map((token) => token.text).join("");
}

function sameCodeLine(left: CodeLine, right: CodeLine): boolean {
  return (
    left.length === right.length &&
    left.every(
      (token, index) => token.text === right[index]?.text && token.type === right[index]?.type,
    )
  );
}

/**
 * The lines of `code`: a highlighted line, else a current line, else plain text, each only while
 * its text is still the same. A line equal to the current one is the current array, so `For`
 * keeps its elements.
 */
export function reusedCodeLines(
  code: string,
  highlightedLines: CodeLine[],
  current: CodeLine[],
): CodeLine[] {
  return code.split("\n").map((text, index) => {
    const highlightedLine = highlightedLines[index];
    const currentLine = current[index];
    const line =
      highlightedLine && codeLineText(highlightedLine) === text
        ? highlightedLine
        : currentLine && codeLineText(currentLine) === text
          ? currentLine
          : [{ text }];
    return currentLine && sameCodeLine(currentLine, line) ? currentLine : line;
  });
}

// Languages that contain lines of a different language, such as script in HTML or a fence in
// Markdown. Their lines have no type, so each one looks like a restart point.
const EMBEDDING_LANGUAGES = new Set<ShjLanguage>(["html", "md", "leanpub-md"]);

// Preserve tokenization before a valid restart point; embedded languages or changed overlap require the whole block.
export async function highlightedCode(
  code: string,
  language: ShjLanguage,
  earlier: HighlightedCode | undefined,
): Promise<HighlightedCode> {
  if (earlier && !EMBEDDING_LANGUAGES.has(language) && code.startsWith(earlier.code)) {
    const completeLines = earlier.lines.length - 1;
    const restart = earlier.restarts.lastIndexOf(true, completeLines - 1);
    if (restart > 0) {
      const kept = earlier.lines.slice(0, restart);
      const start = kept.reduce(
        (length, line) => length + (codeLineText(line)?.length ?? 0) + 1,
        0,
      );
      const rest = await tokenizedCode(code.slice(start), language);
      const overlap = earlier.lines.slice(restart, completeLines);
      if (
        rest &&
        rest.restarts.at(-1) !== false &&
        overlap.every((line, index) => sameCodeLine(line, rest.lines[index] ?? []))
      ) {
        return {
          code,
          language,
          lines: [...kept, ...rest.lines],
          restarts: [...earlier.restarts.slice(0, restart), ...rest.restarts],
        };
      }
    }
  }
  const whole = await tokenizedCode(code, language);
  return {
    code,
    language,
    lines: whole?.lines ?? plainCodeLines(code),
    restarts: whole?.restarts ?? [],
  };
}

async function tokenizedCode(
  code: string,
  language: ShjLanguage,
): Promise<Pick<HighlightedCode, "lines" | "restarts"> | undefined> {
  const lines: CodeLine[] = [[]];
  // Line 0 is a restart point: it is the block start or an earlier restart point.
  const restarts = [true];
  try {
    // At the top level of a language, text that no rule matches has no type.
    await tokenize(code, language, (text, type) => {
      const fragments = text.split("\n");
      for (const [index, fragment] of fragments.entries()) {
        if (fragment) lines.at(-1)?.push({ text: fragment, type });
        if (index < fragments.length - 1) {
          lines.push([]);
          restarts.push(type === undefined);
        }
      }
    });
    return { lines, restarts };
  } catch {
    return undefined;
  }
}

export function codeLanguageLabel(language: string) {
  const selected = codeLanguage(language);
  if (selected === "plain") {
    const original = language.trim();
    if (original.toLowerCase() === "mermaid" || original.toLowerCase() === "mmd") return "Mermaid";
    return original ? original.toUpperCase() : "Plain text";
  }
  const labels: Partial<Record<ShjLanguage, string>> = {
    asm: "Assembly",
    bash: "Shell",
    diff: "Diff",
    regex: "Regular expression",
  };
  return labels[selected] ?? LANGUAGE_LABELS[selected] ?? selected.toUpperCase();
}

export function positionedCodeLines(lines: CodeLine[]) {
  let offset = 0;
  return lines.map((line, index) => {
    const start = offset;
    const tokens = line.map((token) => {
      const start = offset;
      offset += token.text.length;
      return { ...token, offset: start };
    });
    offset += 1;
    return { offset: start, number: index + 1, tokens };
  });
}
