/**
 * From OpenBot mobile's features/chat/model/chat-day-markers.ts. The first
 * timed message of each day gets a label. Untimed rows leave the grouping alone.
 */
const DAY_MS = 86_400_000;
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** One pass over the loaded rows. Sled uses its own date formatting and English copy. */
export function chatDayLabels(
  rows: readonly { id: string; createdAt?: string }[],
  now: Date = new Date(),
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const today = startOfDay(now);
  let previousDay: number | undefined;
  for (const row of rows) {
    if (!row.createdAt) continue;
    const created = new Date(row.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const day = startOfDay(created);
    if (day === previousDay) continue;
    previousDay = day;
    const time = TIME.format(created);
    const age = Math.round((today - day) / DAY_MS);
    labels.set(
      row.id,
      age === 0
        ? `Today ${time}`
        : age === 1
          ? `Yesterday ${time}`
          : `${DATE.format(created)} ${time}`,
    );
  }
  return labels;
}
