/* oxlint-disable shadcn/no-unknown-classes -- RoutineSchedulePicker card rows retain source workflow selectors. */
import { useState } from "react";
import * as Schema from "effect/Schema";
import { OpenbotRoutineSchedule } from "@t3tools/contracts";
import {
  routineScheduleFromDraft,
  routineScheduleToDraft,
  switchDraftKind,
  toggleRoutineDay,
  routineYearlyDaysInMonth,
  ROUTINE_EVERY_HOURS,
  type RoutineScheduleDraft,
  type RoutineDraftKind,
} from "./routineScheduleDraft";
import { decoded } from "./useWorkflowCatalogs";
import { T, useGT } from "gt-react";
const Schedule = Schema.Union([
  OpenbotRoutineSchedule,
  Schema.Struct({ kind: Schema.Literal("once"), date: Schema.String, time: Schema.String }),
]);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function WorkflowSchedulePicker({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (schedule: Schema.Json) => void;
}) {
  const gt = useGT();
  const saved = decoded(Schedule, value) ?? { kind: "daily" as const, time: "09:00" };
  const [edited, setEdited] = useState<RoutineScheduleDraft | null>(null);
  const draft =
    edited && JSON.stringify(routineScheduleFromDraft(edited)) === JSON.stringify(saved)
      ? edited
      : routineScheduleToDraft(saved);
  const change = (next: RoutineScheduleDraft) => {
    setEdited(next);
    onChange(routineScheduleFromDraft(next));
  };
  const row = (name: string, control: React.ReactNode) => (
    <label className="wfn-row">
      <span className="wfn-row-name">{name}</span>
      {control}
    </label>
  );
  return (
    <div className="wfn-settings-block">
      {row(
        "Repeat",
        <select
          aria-label={gt("Repeat")}
          className="wfn-row-value"
          disabled={disabled}
          value={draft.kind}
          onChange={(e) =>
            change(switchDraftKind(draft, e.target.value as RoutineDraftKind, new Date()))
          }
        >
          {["once", "hourly", "daily", "weekly", "monthly", "yearly", "custom"].map((kind) => (
            <option key={kind} value={kind}>
              {kind === "once" ? gt("Once") : kind[0]?.toUpperCase() + kind.slice(1)}
            </option>
          ))}
        </select>,
      )}
      {draft.kind === "once" &&
        row(
          "Date",
          <input
            type="date"
            value={draft.date}
            disabled={disabled}
            onChange={(e) => change({ ...draft, date: e.target.value })}
          />,
        )}
      {draft.kind === "hourly" && (
        <>
          {row(
            "Every",
            <select
              value={draft.everyHours}
              disabled={disabled}
              onChange={(e) => change({ ...draft, everyHours: Number(e.target.value) })}
            >
              {ROUTINE_EVERY_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} {hours === 1 ? "hour" : "hours"}
                </option>
              ))}
            </select>,
          )}
          {row(
            "Hours",
            <select
              value={draft.window ? "window" : "all"}
              disabled={disabled}
              onChange={(e) =>
                change({
                  ...draft,
                  window: e.target.value === "all" ? null : { start: "09:00", end: "18:00" },
                })
              }
            >
              <option value="all">
                <T>All day</T>
              </option>
              <option value="window">
                <T>Between</T>
              </option>
            </select>,
          )}
          {draft.window ? (
            <>
              {row(
                "From",
                <input
                  type="time"
                  value={draft.window.start}
                  disabled={disabled}
                  onChange={(e) =>
                    change({ ...draft, window: { start: e.target.value, end: draft.window!.end } })
                  }
                />,
              )}
              {row(
                "Until",
                <input
                  type="time"
                  value={draft.window.end}
                  disabled={disabled}
                  onChange={(e) =>
                    change({
                      ...draft,
                      window: { start: draft.window!.start, end: e.target.value },
                    })
                  }
                />,
              )}
            </>
          ) : (
            row(
              "Minute",
              <input
                type="number"
                min={0}
                max={59}
                value={draft.minute ?? 0}
                disabled={disabled}
                onChange={(e) =>
                  change({ ...draft, minute: Math.min(59, Math.max(0, Number(e.target.value))) })
                }
              />,
            )
          )}
        </>
      )}
      {(draft.kind === "hourly" || draft.kind === "daily") && (
        <div className="wfn-row">
          <span className="wfn-row-name">
            <T>On</T>
          </span>
          <div className="wfn-row-value">
            {DAYS.map((day, index) => (
              <button
                type="button"
                key={day}
                aria-label={day}
                aria-pressed={draft.days.includes(index)}
                disabled={disabled}
                onClick={() => change({ ...draft, days: toggleRoutineDay(draft.days, index) })}
              >
                {day.slice(0, 2)}
              </button>
            ))}
          </div>
        </div>
      )}
      {draft.kind === "weekly" &&
        row(
          "On",
          <select
            value={draft.weekday}
            disabled={disabled}
            onChange={(e) => change({ ...draft, weekday: Number(e.target.value) })}
          >
            {DAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>,
        )}
      {draft.kind === "yearly" &&
        row(
          "Month",
          <select
            value={draft.month}
            disabled={disabled}
            onChange={(e) => {
              const month = Number(e.target.value);
              change({
                ...draft,
                month,
                day: Math.min(draft.day, routineYearlyDaysInMonth(month)),
              });
            }}
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index} value={index + 1}>
                {new Date(2024, index).toLocaleString(undefined, { month: "long" })}
              </option>
            ))}
          </select>,
        )}
      {(draft.kind === "monthly" || draft.kind === "yearly") &&
        row(
          "Day",
          <input
            type="number"
            min={1}
            max={draft.kind === "yearly" ? routineYearlyDaysInMonth(draft.month) : 31}
            value={draft.day}
            disabled={disabled}
            onChange={(e) =>
              change({
                ...draft,
                day: Math.max(
                  1,
                  Math.min(
                    draft.kind === "yearly" ? routineYearlyDaysInMonth(draft.month) : 31,
                    Number(e.target.value),
                  ),
                ),
              })
            }
          />,
        )}
      {"time" in draft &&
        row(
          "At",
          <input
            type="time"
            value={draft.time}
            disabled={disabled}
            onChange={(e) => change({ ...draft, time: e.target.value })}
          />,
        )}
      {draft.kind === "custom" &&
        row(
          "Cron",
          <input
            value={draft.expression}
            maxLength={255}
            placeholder="0 9 * * 1-5"
            disabled={disabled}
            onChange={(e) => change({ ...draft, expression: e.target.value })}
          />,
        )}
    </div>
  );
}
