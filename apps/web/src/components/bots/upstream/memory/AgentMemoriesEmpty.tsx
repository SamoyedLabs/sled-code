/* oxlint-disable shadcn/no-unknown-classes -- Pinned AgentMemoriesEmpty illustration and timing. */
import { useEffect, useState, type CSSProperties } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SourceButton } from "../settings/SettingsParts";
import { t } from "../data/source-text";
const samples = [
  { text: "memory.sample.updates", origin: "automatic" },
  { text: "memory.sample.scripts", origin: "manual" },
  { text: "memory.sample.brief", origin: "automatic" },
  { text: "memory.sample.confirm", origin: "manual" },
];
export function AgentMemoriesEmpty(props: {
  ownerNoun: "agent" | "channel";
  ownerLabel: string;
  addDisabled: boolean;
  onAdd: () => void;
}) {
  const [still, setStill] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [step, setStep] = useState(() => (still ? 3 : 0));
  const [today] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Follow reduced motion and the source empty-state illustration clock, disposing both on close.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      setStill(media.matches);
      setStep(media.matches ? 3 : 0);
    };
    media.addEventListener("change", changed);
    const timer = window.setInterval(() => {
      if (!media.matches && !document.hidden) setStep((value) => value + 1);
    }, 3000);
    return () => {
      media.removeEventListener("change", changed);
      window.clearInterval(timer);
    };
  }, []);
  const position = step % 5;
  const shown = samples
    .slice(0, Math.min(position + 1, 4))
    .map((memory, index) => ({ key: `${Math.floor(step / 5)}-${index}`, memory, index }))
    .reverse();
  const [before = "", after = ""] = t("memory.emptyTitle", { remember: "\u0000" }).split("\u0000");
  return (
    <div className="agent-memories-empty" data-still={still ? "" : undefined}>
      <ul
        className="agent-memory-list agent-memories-empty-list"
        aria-hidden="true"
        data-clearing={position === 4 ? "" : undefined}
      >
        {shown.map((item, age) => {
          const text = t(item.memory.text),
            lines = handLines(text),
            gaps = lines.length * 140,
            chars = lines.reduce((sum, line) => sum + line.length, 0),
            perChar = Math.min(30, (2600 - 500 - gaps) / chars);
          let written = 0;
          const timed = lines.map((line) => {
            const delay = 500 + written * perChar + 140 * lines.indexOf(line);
            written += line.length;
            return { line, delay };
          });
          return (
            <li
              className="agent-memories-empty-item"
              key={item.key}
              data-age={Math.min(age, 3)}
              data-dry={age > 0 ? "" : undefined}
            >
              <span className="agent-memory-row agent-memories-empty-row">
                <span className="ui-button ui-button-variant-ghost ui-button-size-default agent-memory-row-main">
                  <span className="agent-memories-empty-fold agent-memories-empty-fold-hand">
                    <span>
                      <span className="agent-memories-hand agent-memories-empty-hand">
                        {timed.map(({ line, delay }) => (
                          <span
                            className="agent-memories-empty-line"
                            key={line}
                            style={
                              {
                                "--agent-memories-empty-delay": `${delay}ms`,
                                "--agent-memories-empty-length": `${line.length * perChar}ms`,
                              } as CSSProperties
                            }
                          >
                            {line}
                          </span>
                        ))}
                      </span>
                    </span>
                  </span>
                  <span className="agent-memories-empty-fold agent-memories-empty-fold-typed">
                    <span className="agent-memory-text">{text}</span>
                  </span>
                  <span
                    className="agent-memory-meta agent-memories-empty-meta"
                    style={
                      {
                        "--agent-memories-empty-delay": `${500 + written * perChar + gaps}ms`,
                      } as CSSProperties
                    }
                  >
                    {t(item.memory.origin === "automatic" ? "memory.learned" : "memory.manual")} ·{" "}
                    {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                      new Date(today - (3 - item.index) * 86_400_000),
                    )}
                  </span>
                </span>
                <span className="ui-button ui-button-variant-destructive-ghost ui-button-size-icon-sm ui-icon-button agent-memory-delete-button">
                  <Trash2 />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="agent-memories-empty-pitch">
        <h3 className="agent-memories-empty-title">
          <span className="agent-memories-empty-lead">{t("memory.emptyLead")}</span>
          <span>
            {before}
            <span className="agent-memories-hand agent-memories-empty-word">
              {t("memory.emptyRemember")}
            </span>
            {after}
          </span>
        </h3>
        <p className="agent-memories-empty-lines">
          <span>
            {t(
              props.ownerNoun === "agent" ? "memory.emptyLearnsAgent" : "memory.emptyLearnsChannel",
              { name: props.ownerLabel },
            )}
          </span>
          <span>{t("memory.emptyAddOwn")}</span>
        </p>
        <SourceButton
          variant="default"
          size="default"
          className="agent-memories-empty-action"
          disabled={props.addDisabled}
          onClick={props.onAdd}
        >
          <Plus />
          {t("memory.add")}
        </SourceButton>
      </div>
    </div>
  );
}
function handLines(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  const width = (value: string) =>
    Array.from(value).reduce(
      (total, char) => total + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1),
      0,
    );
  const add = (part: string, gap: string) => {
    if (line && width(line) + width(gap) + width(part) > 46) {
      lines.push(line);
      line = part;
    } else line = line ? `${line}${gap}${part}` : part;
  };
  for (const word of text.split(" ")) {
    if (width(word) <= 46) {
      add(word, " ");
      continue;
    }
    let first = true;
    for (const char of word) {
      add(char, first ? " " : "");
      first = false;
    }
  }
  if (line) lines.push(line);
  return lines;
}
