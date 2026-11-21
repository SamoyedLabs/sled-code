export interface TimelineRow {
  id: string;
  /** Whether the reader would call this row a new message. */
  countable: boolean;
}

export interface NewMessageTally {
  count: number;
  /** The last id the reader has accounted for. `undefined` before the first page arrives. */
  anchorId: string | undefined;
}

/** The reader has seen everything: no count, and the newest row becomes the anchor. */
export function anchorNewMessages(rows: readonly TimelineRow[]): NewMessageTally {
  return { count: 0, anchorId: rows.at(-1)?.id };
}

/**
 * Tally after a timeline change. Every row anchors (including non-countable rows) so the first
 * reply after a user prompt still counts; `following` must be read before any scroll frame.
 */
export function tallyNewMessages(
  previous: NewMessageTally,
  rows: readonly TimelineRow[],
  following: boolean,
): NewMessageTally {
  if (following) return anchorNewMessages(rows);
  const latest = rows[rows.length - 1];
  if (!latest) return { count: 0, anchorId: undefined };
  const latestId = latest.id;
  const anchorIndex =
    previous.anchorId === undefined ? -1 : rows.findIndex((row) => row.id === previous.anchorId);
  /*
   * Nothing here says what arrived, so the count stands: the anchor is missing because a message
   * was deleted, because a page scrolled out of the window, or because this is the first page of
   * a thread the reader just opened, and none of those is news.
   */
  if (anchorIndex < 0) return { count: previous.count, anchorId: latestId };
  let arrived = 0;
  // A body that grows while it streams, and an older page that only prepends, both add nothing.
  for (let index = anchorIndex + 1; index < rows.length; index += 1) {
    if (rows[index]?.countable) arrived += 1;
  }
  return { count: previous.count + arrived, anchorId: latestId };
}
