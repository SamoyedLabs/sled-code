import { type RoutineClock, routineTimeMinutes } from "./routine-schedule-draft";
export type RoutineMeridiem = "AM" | "PM";

export interface RoutineClockParts {
  hour: number;
  minute: number;
  meridiem: RoutineMeridiem;
}

export function splitClock(value: RoutineClock): RoutineClockParts {
  const minutes = routineTimeMinutes(value);
  const hour24 = Math.floor(minutes / 60) % 24;
  return { hour: hour24 % 12 || 12, minute: minutes % 60, meridiem: hour24 >= 12 ? "PM" : "AM" };
}

export function joinClock(parts: RoutineClockParts): RoutineClock {
  const hour = clamp(Math.trunc(parts.hour), 1, 12) % 12;
  const hour24 = parts.meridiem === "PM" ? hour + 12 : hour;
  const minute = clamp(Math.trunc(parts.minute), 0, 59);
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour on a 24-hour clock: 0 to 23. */
export function clockHour24(value: RoutineClock): number {
  return Math.floor(routineTimeMinutes(value) / 60) % 24;
}

/** A typed hour of a 24-hour clock as the hour and half of the day. Values out of range clamp to 0 or 23. */
export function clockHourFrom24(hour24: number): Pick<RoutineClockParts, "hour" | "meridiem"> {
  const hour = clamp(Math.trunc(hour24), 0, 23);
  return { hour: hour % 12 || 12, meridiem: hour >= 12 ? "PM" : "AM" };
}

/**
 * Reads a typed hour. The box shows a 12-hour clock, but a person can type a 24-hour one: 18 is
 * 6 PM and 0 is 12 AM. Other values keep the half of the day that is set.
 */
export function typedClockHour(
  typed: number,
  meridiem: RoutineMeridiem,
): Pick<RoutineClockParts, "hour" | "meridiem"> {
  if (typed === 0) return { hour: 12, meridiem: "AM" };
  if (typed > 12 && typed < 24) return { hour: typed - 12, meridiem: "PM" };
  return { hour: typed, meridiem };
}

/** Wraps a stepped value inside its range, so ArrowUp on 12 gives 1 and ArrowDown on 0 gives 59. */
export function wrapClockValue(value: number, min: number, max: number): number {
  const span = max - min + 1;
  return ((((value - min) % span) + span) % span) + min;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
