/* oxlint-disable shadcn/no-unknown-classes -- Pinned RoutineDateField yearly branch and keyboard calendar. */
import { useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Popover } from "@base-ui/react/popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { renderClosingPositioner } from "../../../ui/closing-positioner";
import { menuMotionRef } from "../openbotMenuMotion";
import { SourceButton } from "./SettingsParts";
import { routineDateKey, parseRoutineDateKey } from "./routine-schedule-draft";
const YEAR = 2024;
export function RoutineYearlyDateField({
  month,
  day,
  onChange,
  disabled,
}: {
  month: number;
  day: number;
  onChange: (month: number, day: number) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const value = routineDateKey(new Date(YEAR, month - 1, day));
  const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    parseRoutineDateKey(value),
  );
  return (
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="routine-chip routine-chip-flexible"
        aria-label={`Date: ${label}`}
        disabled={disabled}
      >
        <span className="routine-chip-text">{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align="start"
          className="openbot-react openbot-popup-positioner"
          data-openbot-positioner=""
          render={renderClosingPositioner}
        >
          <Popover.Popup
            ref={menuMotionRef(undefined)}
            className="ui-popover-menu-surface routine-popover routine-calendar-popover"
          >
            <Popover.Title className="sr-only">Choose a date</Popover.Title>
            <YearlyCalendar
              value={value}
              onSelect={(value) => {
                const date = parseRoutineDateKey(value);
                onChange(date.getMonth() + 1, date.getDate());
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
function YearlyCalendar({ value, onSelect }: { value: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(() => parseRoutineDateKey(value).getMonth()),
    [focusKey, setFocusKey] = useState(value);
  const grid = useRef<HTMLFieldSetElement>(null);
  const days = Array.from({ length: new Date(YEAR, month + 1, 0).getDate() }, (_, index) =>
    routineDateKey(new Date(YEAR, month, index + 1)),
  );
  const tabStop = days.includes(focusKey) ? focusKey : days[0];
  const title = new Intl.DateTimeFormat(undefined, { month: "long" }).format(
    new Date(YEAR, month, 1),
  );
  const move = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight",
      rtl = getComputedStyle(event.currentTarget).direction === "rtl",
      date = parseRoutineDateKey(key),
      next = new Date(YEAR, date.getMonth(), date.getDate() + (horizontal && rtl ? -step : step));
    next.setFullYear(YEAR);
    const nextKey = routineDateKey(next);
    flushSync(() => {
      setFocusKey(nextKey);
      setMonth(next.getMonth());
    });
    grid.current?.querySelector<HTMLElement>(`[data-date="${nextKey}"]`)?.focus();
  };
  return (
    <div className="routine-calendar">
      <div className="routine-calendar-header">
        <SourceButton
          variant="ghost"
          size="xs"
          aria-label="Previous month"
          onClick={() => setMonth((month + 11) % 12)}
        >
          <ChevronLeft aria-hidden="true" />
        </SourceButton>
        <span className="routine-calendar-title" aria-live="polite">
          {title}
        </span>
        <SourceButton
          variant="ghost"
          size="xs"
          aria-label="Next month"
          onClick={() => setMonth((month + 1) % 12)}
        >
          <ChevronRight aria-hidden="true" />
        </SourceButton>
      </div>
      <fieldset ref={grid} className="routine-calendar-days" aria-label={title}>
        {days.map((key) => {
          const date = parseRoutineDateKey(key);
          return (
            <SourceButton
              key={key}
              variant="ghost"
              className={`routine-day routine-calendar-day${key === value ? " routine-day-selected" : ""}`}
              data-date={key}
              tabIndex={key === tabStop ? 0 : -1}
              aria-label={new Intl.DateTimeFormat(undefined, {
                month: "long",
                day: "numeric",
              }).format(date)}
              aria-pressed={key === value}
              onFocus={() => setFocusKey(key)}
              onKeyDown={(event) => move(event, key)}
              onClick={() => onSelect(key)}
            >
              {date.getDate()}
            </SourceButton>
          );
        })}
      </fieldset>
    </div>
  );
}
