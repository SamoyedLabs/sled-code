/* oxlint-disable shadcn/no-unknown-classes -- Decorative source TasksEmpty selectors are in tasks.css. */
import { useEffect, useState, type CSSProperties } from "react";
import { Check, Circle } from "lucide-react";
import { BotAvatar } from "../../avatar/BotAvatar";
import { useGT } from "gt-react";
const samples = [
  ["Summarise the open hiring loops for the design lead role", "Reading hiring-tracker.md"],
  ["Find recent papers on retrieval for long documents", "Searching arxiv.org"],
  ["Prepare the call notes for Northwind Traders", "Reading the account history"],
  ["Make a shortlist of venues for the team offsite", "Searching venues for 18 people"],
  ["Read the Mamba paper and note the main claims", "Reading mamba.pdf"],
  ["Clean the CRM export and remove duplicate contacts", "Reading crm-export.csv"],
] as const;
export function TasksEmptyBoard({
  agents,
}: {
  agents: readonly { id: string; avatarSeed?: string | undefined }[];
}) {
  const gt = useGT();
  const [step, setStep] = useState(2);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Advance the upstream decorative task illustration, respecting the system motion preference.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setStep((value) => value + 1), 2400);
    return () => clearInterval(timer);
  }, []);
  const shown = Array.from({ length: Math.min(step + 1, 4) }, (_, offset) => {
    const index = Math.max(0, step - 3) + offset;
    return { index, age: step - index, sample: samples[index % samples.length]! };
  });
  return (
    <div className="tasks-page-empty-board" aria-hidden="true" inert>
      {["Needs you", "Working", "Waiting"].map((title) => (
        <div key={title} className="tasks-page-section tasks-page-empty-section">
          <p className="tasks-page-section-heading">
            <span>{title}</span>
            <span className="tasks-page-count">1</span>
          </p>
        </div>
      ))}
      <div className="tasks-page-empty-rows">
        {shown.map(({ index, age, sample }) => (
          <div
            key={index}
            className="tasks-page-empty-row"
            data-age={age}
            style={{ "--tasks-page-empty-slot": 2 - Math.min(age, 2) } as CSSProperties}
          >
            <span className="ui-button tasks-page-row">
              {age >= 2 ? <Check size={14} /> : <Circle size={14} />}
              <span className="tasks-page-row-title">{sample[0]}</span>
              <span
                className="tasks-page-status"
                data-tone={age === 1 ? "working" : age >= 2 ? "attention" : undefined}
              >
                {age === 0 ? gt("Waiting") : age === 1 ? sample[1] : gt("Answered")}
              </span>
              <BotAvatar
                seed={
                  agents[index % agents.length]?.avatarSeed ??
                  agents[index % agents.length]?.id ??
                  String(index)
                }
                size={18}
                mood={age === 0 ? "waiting" : age === 1 ? "working" : "responded"}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
