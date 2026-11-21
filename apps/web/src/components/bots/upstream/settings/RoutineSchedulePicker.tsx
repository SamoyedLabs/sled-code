/* oxlint-disable shadcn/no-unknown-classes -- Pinned RoutineSchedulePicker and chip/popover selectors. */
import { useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { AlarmClock, Check } from "lucide-react";
import { observeResize } from "../../../../lib/observeResize";
import { renderClosingPositioner } from "../../../ui/closing-positioner";
import { menuMotionRef } from "../openbotMenuMotion";
import { SourceButton } from "./SettingsParts";
import {
  ROUTINE_EVERY_DAY,
  ROUTINE_EVERY_HOURS,
  ROUTINE_SAVED_DRAFT_KIND_VALUES,
  ROUTINE_DRAFT_KIND_VALUES,
  switchDraftKind,
  isRoutineDraftKind,
  toggleRoutineDay,
  type RoutineScheduleDraft,
} from "./routine-schedule-draft";
import {
  splitClock,
  joinClock,
  clockHour24,
  clockHourFrom24,
  typedClockHour,
  wrapClockValue,
  type RoutineClockParts,
} from "./routine-clock";
import { RoutineYearlyDateField } from "./RoutineYearlyDateField";
import "./routine-schedule.css";
import { m } from "../../../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react";
const weekday = (day: number, style: "long" | "short" | "narrow" = "short") =>
  new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(2024, 0, 7 + day));
export const clockLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: value.endsWith(":00") ? undefined : "2-digit",
  }).format(new Date(`2024-01-01T${value}:00`));
export function daysLabel(days: readonly number[]) {
  return days.length === 7
    ? m(msg("Every day"))
    : days.join(",") === "1,2,3,4,5"
      ? m(msg("Weekdays"))
      : days.join(",") === "0,6"
        ? m(msg("Weekends"))
        : days.map((day) => weekday(day)).join(", ");
}
function Phrase({
  word,
  children,
  flexible = false,
}: {
  word: string;
  children: ReactNode;
  flexible?: boolean;
}) {
  return (
    <span className={`routine-trigger-phrase${flexible ? " routine-trigger-phrase-flexible" : ""}`}>
      <span className="routine-connector">{word}</span>
      {children}
    </span>
  );
}
export function RoutineChipSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  valueLabel,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  valueLabel?: string | undefined;
}) {
  return (
    <Select.Root
      value={value}
      items={[...options]}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next);
      }}
    >
      <Select.Trigger className="routine-chip" aria-label={label}>
        <Select.Value className="routine-chip-text">
          {valueLabel ?? options.find((option) => option.value === value)?.label}
        </Select.Value>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
          className="openbot-react openbot-popup-positioner"
          data-openbot-positioner=""
          render={renderClosingPositioner}
        >
          <Select.Popup
            ref={menuMotionRef(undefined)}
            className="ui-select-content routine-chip-select-content"
          >
            <Select.List className="ui-select-listbox">
              {options.map((option) => (
                <Select.Item className="ui-select-item" key={option.value} value={option.value}>
                  <Select.ItemText className="ui-select-item-label">{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="ui-select-item-indicator">
                    <Check aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
function ChipPopover({
  label,
  children,
  content,
  kind,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  content: ReactNode;
  kind: string;
  disabled?: boolean;
}) {
  return (
    <Popover.Root modal>
      <Popover.Trigger
        className="routine-chip routine-chip-flexible"
        aria-label={label}
        disabled={disabled}
      >
        <span className="routine-chip-text">{children}</span>
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
            className={`ui-popover-menu-surface routine-popover ${kind}`}
          >
            <Popover.Title className="sr-only">{label}</Popover.Title>
            {content}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
function Weekdays({
  days,
  onChange,
  disabled,
  single = false,
}: {
  days: number[];
  onChange: (days: number[]) => void;
  disabled: boolean;
  single?: boolean;
}) {
  const gt = useGT();
  return (
    <ChipPopover
      label={gt("Choose days")}
      kind="routine-weekday-popover"
      disabled={disabled}
      content={
        single ? (
          <RadioGroup
            className="routine-weekday-strip"
            aria-label={gt("Day")}
            value={String(days[0])}
            onValueChange={(value) => onChange([Number(value)])}
          >
            {ROUTINE_EVERY_DAY.map((day) => (
              <Radio.Root
                key={day}
                value={String(day)}
                className={`routine-day${days.includes(day) ? " routine-day-selected" : ""}`}
                aria-label={weekday(day, "long")}
              >
                {weekday(day, "narrow")}
              </Radio.Root>
            ))}
          </RadioGroup>
        ) : (
          <fieldset className="routine-weekday-strip" aria-label={gt("Days")}>
            {ROUTINE_EVERY_DAY.map((day) => (
              <SourceButton
                key={day}
                variant="ghost"
                className={`routine-day${days.includes(day) ? " routine-day-selected" : ""}`}
                aria-label={weekday(day, "long")}
                aria-pressed={days.includes(day)}
                disabled={days.length === 1 && days.includes(day)}
                onClick={() => onChange(toggleRoutineDay(days, day))}
              >
                {weekday(day, "narrow")}
              </SourceButton>
            ))}
          </fieldset>
        )
      }
    >
      {daysLabel(days)}
    </ChipPopover>
  );
}
function ClockInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
}) {
  const gt = useGT();
  const hour12 = Boolean(
    new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12,
  );
  const parts = splitClock(value),
    shown = (time: string) =>
      hour12 ? String(splitClock(time).hour) : String(clockHour24(time)).padStart(2, "0");
  const [hour, setHour] = useState(shown(value)),
    [minute, setMinute] = useState(String(parts.minute).padStart(2, "0"));
  const commit = (next: Partial<RoutineClockParts>) => {
    const time = joinClock({ ...parts, ...next });
    onChange(time);
    setHour(shown(time));
    setMinute(String(splitClock(time).minute).padStart(2, "0"));
  };
  const parsed = (text: string, fallback: number) =>
    Number.isFinite(Number.parseInt(text, 10)) ? Number.parseInt(text, 10) : fallback;
  const commitField = (field: "hour" | "minute") =>
    field === "hour"
      ? commit(
          hour12
            ? typedClockHour(parsed(hour, parts.hour), parts.meridiem)
            : clockHourFrom24(parsed(hour, clockHour24(value))),
        )
      : commit({ minute: parsed(minute, parts.minute) });
  const step = (event: KeyboardEvent<HTMLInputElement>, field: "hour" | "minute") => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitField(field);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 1 : -1;
    commit(
      field === "minute"
        ? { minute: wrapClockValue(parts.minute + delta, 0, 59) }
        : hour12
          ? { hour: wrapClockValue(parts.hour + delta, 1, 12) }
          : clockHourFrom24(wrapClockValue(clockHour24(value) + delta, 0, 23)),
    );
  };
  return (
    <div className="routine-clock-input">
      <input
        className="ui-input routine-clock-segment"
        data-size="sm"
        inputMode="numeric"
        maxLength={2}
        aria-label={`${label} hour`}
        value={hour}
        onChange={(event) => setHour(event.target.value)}
        onBlur={() => commitField("hour")}
        onKeyDown={(event) => step(event, "hour")}
      />
      <span className="routine-clock-separator" aria-hidden="true">
        :
      </span>
      <input
        className="ui-input routine-clock-segment"
        data-size="sm"
        inputMode="numeric"
        maxLength={2}
        aria-label={`${label} minute`}
        value={minute}
        onChange={(event) => setMinute(event.target.value)}
        onBlur={() => commitField("minute")}
        onKeyDown={(event) => step(event, "minute")}
      />
      {hour12 && (
        <RadioGroup
          className="routine-segmented"
          aria-label={gt("{label} AM or PM", { label })}
          value={parts.meridiem}
          onValueChange={(value) => commit({ meridiem: value === "PM" ? "PM" : "AM" })}
        >
          {["AM", "PM"].map((value) => (
            <Radio.Root key={value} value={value} className="routine-segmented-control">
              {value}
            </Radio.Root>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}
function Time({
  value,
  onChange,
  disabled,
  label: rawLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label?: string;
}) {
  const gt = useGT();
  const label = rawLabel ?? gt("Time");
  return (
    <ChipPopover
      label={label}
      kind="routine-time-popover"
      disabled={disabled}
      content={<ClockInput label={label} value={value} onChange={onChange} />}
    >
      {clockLabel(value)}
    </ChipPopover>
  );
}
function Hours({
  draft,
  onChange,
  disabled,
}: {
  draft: Extract<RoutineScheduleDraft, { kind: "hourly" }>;
  onChange: (draft: RoutineScheduleDraft) => void;
  disabled: boolean;
}) {
  const gt = useGT();
  const previous = useRef({ start: "09:00", end: "18:00" });
  const choose = (kind: unknown) => {
    if (kind === "all-day") {
      if (draft.window) previous.current = draft.window;
      onChange({ ...draft, window: null });
    } else onChange({ ...draft, window: draft.window ?? previous.current });
  };
  const label = draft.window
    ? `${clockLabel(draft.window.start)}–${clockLabel(draft.window.end)}`
    : draft.minute
      ? `All day at :${String(draft.minute).padStart(2, "0")}`
      : "All day";
  return (
    <ChipPopover
      label={gt("Choose hours")}
      kind="routine-window-menu"
      disabled={disabled}
      content={
        <>
          <RadioGroup
            className="routine-window-options"
            aria-label={gt("Hours")}
            value={draft.window ? "between" : "all-day"}
            onValueChange={choose}
          >
            {[
              { value: "all-day", label: gt("All day") },
              { value: "between", label: gt("Between hours") },
            ].map((item) => (
              <Radio.Root
                className="routine-window-option-control"
                key={item.value}
                value={item.value}
              >
                <span className="routine-window-option-label">{item.label}</span>
                <Radio.Indicator className="routine-window-option-check">
                  <Check aria-hidden="true" />
                </Radio.Indicator>
              </Radio.Root>
            ))}
          </RadioGroup>
          {draft.window && (
            <div className="routine-window-range">
              <div className="routine-window-range-times">
                <Time
                  label={gt("Start time")}
                  value={draft.window.start}
                  disabled={disabled}
                  onChange={(start) =>
                    onChange({ ...draft, window: { start, end: draft.window!.end } })
                  }
                />
                <span>to</span>
                <Time
                  label={gt("End time")}
                  value={draft.window.end}
                  disabled={disabled}
                  onChange={(end) =>
                    onChange({ ...draft, window: { start: draft.window!.start, end } })
                  }
                />
              </div>
            </div>
          )}
          <div className="routine-window-repeat">
            <span className="routine-window-repeat-label">
              <T>Repeat every</T>
            </span>
            <RoutineChipSelect
              label={gt("Repeat every")}
              value={String(draft.everyHours)}
              options={ROUTINE_EVERY_HOURS.map((value) => ({
                value: String(value),
                label: `${value} ${value === 1 ? "hour" : "hours"}`,
              }))}
              onChange={(value) => onChange({ ...draft, everyHours: Number(value) })}
            />
          </div>
        </>
      }
    >
      {label}
    </ChipPopover>
  );
}
export function RoutineSchedulePicker({
  allowOnce = false,
  schedule,
  onChange,
  disabled = false,
}: {
  allowOnce?: boolean;
  schedule: RoutineScheduleDraft;
  onChange: (draft: RoutineScheduleDraft) => void;
  disabled?: boolean;
}) {
  const gt = useGT();
  const root = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Measure rendered chip labels and keep the source fit levels synchronized with DOM widths and loaded fonts.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      for (const level of ["roomy", "snug", "tight", "minimal"]) {
        el.dataset.fit = level;
        const chips = el.querySelector(".routine-trigger-chips"),
          last = chips?.lastElementChild;
        if (
          chips &&
          last &&
          last.getBoundingClientRect().right > chips.getBoundingClientRect().right + 0.5
        )
          continue;
        if (
          Array.from(
            el.querySelectorAll(".routine-chip-text"),
            (node) => node.scrollWidth <= node.clientWidth,
          ).every(Boolean)
        )
          break;
      }
    };
    fit();
    const stop = observeResize(el, fit);
    void document.fonts.ready.then(fit);
    return stop;
  });
  return (
    <div ref={root} className="routine-schedule-picker" data-density="panel">
      <fieldset className="routine-trigger-row" aria-label={gt("Schedule")}>
        <span className="routine-trigger-icon" aria-hidden="true">
          <AlarmClock />
        </span>
        <span className="routine-trigger-chips">
          <RoutineChipSelect
            label={gt("Frequency")}
            disabled={disabled}
            value={schedule.kind}
            valueLabel={
              schedule.kind === "hourly" && schedule.everyHours > 1
                ? gt("Every {everyHours}h", { everyHours: schedule.everyHours })
                : undefined
            }
            options={(allowOnce ? ROUTINE_DRAFT_KIND_VALUES : ROUTINE_SAVED_DRAFT_KIND_VALUES).map(
              (value) => ({
                value,
                label: value === "custom" ? gt("Custom") : value[0]!.toUpperCase() + value.slice(1),
              }),
            )}
            onChange={(value) => {
              if (isRoutineDraftKind(value) && (allowOnce || value !== "once"))
                onChange(switchDraftKind(schedule, value, new Date()));
            }}
          />
          {(schedule.kind === "daily" || schedule.kind === "hourly") && (
            <Phrase word="on" flexible>
              <Weekdays
                days={schedule.days}
                onChange={(days) => onChange({ ...schedule, days })}
                disabled={disabled}
              />
            </Phrase>
          )}
          {schedule.kind === "weekly" && (
            <Phrase word="on" flexible>
              <Weekdays
                single
                days={[schedule.weekday]}
                onChange={(days) => onChange({ ...schedule, weekday: days[0]! })}
                disabled={disabled}
              />
            </Phrase>
          )}
          {schedule.kind === "monthly" && (
            <Phrase word="on">
              <RoutineChipSelect
                label={gt("Day of month")}
                value={String(schedule.day)}
                disabled={disabled}
                options={Array.from({ length: 31 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                }))}
                onChange={(value) => onChange({ ...schedule, day: Number(value) })}
              />
            </Phrase>
          )}
          {schedule.kind === "once" && (
            <Phrase word="on">
              <input
                type="date"
                className="ui-input routine-once-date"
                aria-label={gt("Run date")}
                disabled={disabled}
                value={schedule.date}
                onChange={(event) => onChange({ ...schedule, date: event.target.value })}
              />
            </Phrase>
          )}
          {schedule.kind === "yearly" && (
            <Phrase word="on">
              <RoutineYearlyDateField
                month={schedule.month}
                day={schedule.day}
                disabled={disabled}
                onChange={(month, day) => onChange({ ...schedule, month, day })}
              />
            </Phrase>
          )}
          {"time" in schedule && (
            <Phrase word="at">
              <Time
                value={schedule.time}
                onChange={(time) => onChange({ ...schedule, time })}
                disabled={disabled}
              />
            </Phrase>
          )}
          {schedule.kind === "hourly" && (
            <Hours draft={schedule} onChange={onChange} disabled={disabled} />
          )}
          {schedule.kind === "custom" && (
            <input
              className="ui-input routine-cron-input"
              aria-label={gt("Cron expression")}
              placeholder="0 9 * * 1-5"
              maxLength={255}
              disabled={disabled}
              value={schedule.expression}
              onChange={(event) => onChange({ ...schedule, expression: event.target.value })}
            />
          )}
        </span>
      </fieldset>
      {schedule.kind === "monthly" && schedule.day > 28 && (
        <p className="routine-schedule-hint">
          <T>
            Months without day <Var>{schedule.day}</Var> are skipped.
          </T>
        </p>
      )}
      {schedule.kind === "custom" && (
        <p className="routine-schedule-hint">
          <T>Minute, hour, day of month, month, day of week.</T>
        </p>
      )}
    </div>
  );
}
