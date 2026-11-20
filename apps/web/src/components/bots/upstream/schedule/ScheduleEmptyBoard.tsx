/* oxlint-disable shadcn/no-unknown-classes -- RoutineCalendarEmpty source selectors are in routine-calendar.css. */
import { useEffect, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { BotAvatar } from "../../avatar/BotAvatar";
import { calendarMonthStart } from "./calendarDates";
const samples = [
  {
    name: "Pipeline report",
    time: "17:30",
    agent: 2,
    note: "up 12% on\nlast month",
    row: 0,
    column: 3,
  },
  {
    name: "Morning brief",
    time: "07:00",
    agent: 0,
    note: "3 meetings,\none clash at 2",
    row: 2,
    column: 0,
  },
  {
    name: "Inbox triage",
    time: "09:00",
    agent: 0,
    note: "quiet day,\n3 sorted",
    row: 2,
    column: 6,
  },
  { name: "Lead follow-up", time: "14:00", agent: 2, note: "Acme said yes!", row: 4, column: 1 },
  { name: "Inbox triage", time: "09:00", agent: 0, note: "inbox zero\nby 9:04", row: 0, column: 6 },
  { name: "Paper digest", time: "08:30", agent: 1, note: "2 worth\nreading", row: 3, column: 0 },
  {
    name: "Lead follow-up",
    time: "14:00",
    agent: 2,
    note: "4 replies,\n1 call booked",
    row: 1,
    column: 1,
  },
] as const;
export function ScheduleEmptyBoard({
  days,
  today,
  agents,
}: {
  days: readonly string[];
  today: string;
  agents: readonly { id: string; avatarSeed?: string | undefined }[];
}) {
  const [step, setStep] = useState(2);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Advance the source calendar illustration only when the system allows motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setStep((value) => value + 1), 2200);
    return () => clearInterval(timer);
  }, []);
  const shown = Array.from({ length: 3 }, (_, offset) => {
    const index = step - 2 + offset;
    return { index, sample: samples[index % samples.length]! };
  });
  return (
    <div className="routine-planner-empty-board" aria-hidden="true" inert>
      <ol className="routine-planner-empty-cells">
        {days.map((day) => (
          <li
            key={day}
            className="routine-planner-empty-cell"
            data-today={day === today ? "" : undefined}
            data-outside={calendarMonthStart(day) === calendarMonthStart(today) ? undefined : ""}
          >
            {Number(day.slice(-2))}
          </li>
        ))}
      </ol>
      <div className="routine-planner-empty-runs">
        {shown.map(({ index, sample }) => {
          let written = 0;
          return (
            <div
              key={index}
              className="routine-planner-empty-run"
              style={
                {
                  "--routine-planner-empty-life": "6600ms",
                  "--routine-planner-empty-row":
                    (sample.row % Math.max(1, Math.ceil(days.length / 7))) + 1,
                  "--routine-planner-empty-column": sample.column + 1,
                  "--routine-planner-empty-slot": (index % 3) + 1,
                } as CSSProperties
              }
            >
              <span className="ui-button routine-planner-run" data-status="completed">
                <span className="routine-planner-status" data-status="completed">
                  <Check className="routine-planner-empty-check" size={14} />
                </span>
                <span className="routine-planner-run-time">{sample.time}</span>
                <span className="routine-planner-run-name">{sample.name}</span>
                <span className="routine-planner-avatars">
                  <BotAvatar
                    seed={
                      agents[sample.agent % agents.length]?.avatarSeed ??
                      agents[sample.agent % agents.length]?.id ??
                      String(sample.agent)
                    }
                    size={18}
                  />
                </span>
              </span>
              <p className="routine-planner-hand routine-planner-empty-note">
                {sample.note.split("\n").map((line, lineIndex) => {
                  const delay = 900 + written * 55 + lineIndex * 160;
                  written += line.length;
                  return (
                    <span
                      key={line}
                      className="routine-planner-empty-line"
                      style={
                        {
                          "--routine-planner-empty-delay": `${delay}ms`,
                          "--routine-planner-empty-length": `${line.length * 55}ms`,
                        } as CSSProperties
                      }
                    >
                      {line}
                    </span>
                  );
                })}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
