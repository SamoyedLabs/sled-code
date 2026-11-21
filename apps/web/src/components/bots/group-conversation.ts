import type { OpenbotChannelMessage, OpenbotChannelTask } from "@t3tools/contracts";

export function continuesGroupSender(
  previous: OpenbotChannelMessage | undefined,
  current: OpenbotChannelMessage,
) {
  if (
    !previous ||
    previous.author.id !== current.author.id ||
    previous.author.kind !== current.author.kind
  )
    return false;
  const before = new Date(previous.message.createdAt);
  const after = new Date(current.message.createdAt);
  if (
    Number.isNaN(before.getTime()) ||
    Number.isNaN(after.getTime()) ||
    before.toDateString() !== after.toDateString()
  )
    return false;
  return after.getTime() - before.getTime() <= 5 * 60_000;
}

export function groupWorkerIds(
  tasks: readonly OpenbotChannelTask[],
  entries: readonly OpenbotChannelMessage[],
  lead: string | null,
) {
  const ids = new Set<string>();
  for (const task of tasks)
    if (task.state === "running" && task.ownerAgentId) ids.add(task.ownerAgentId);
  for (const entry of entries)
    if (entry.message.status === "streaming" && entry.author.kind !== "member")
      ids.add(entry.author.id);
  if (
    lead &&
    tasks.some(
      (task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting"),
    )
  )
    ids.add(lead);
  return [...ids];
}

export function stoppedGroupRuns(tasks: readonly OpenbotChannelTask[]) {
  const roots = new Map<string, OpenbotChannelTask>();
  for (const task of tasks) {
    if (!((task.state === "paused" || task.state === "failed") && task.error)) continue;
    if (!roots.has(task.rootTaskId) || task.id === task.rootTaskId)
      roots.set(task.rootTaskId, task);
  }
  return [...roots.values()];
}

// OpenBot chat-day-markers.ts: local-midnight differences remain correct across DST.
export function groupDayMarker(
  previousIso: string | undefined,
  currentIso: string,
  now = new Date(),
): string | null {
  const current = new Date(currentIso);
  if (Number.isNaN(current.getTime())) return null;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const previous = previousIso === undefined ? null : new Date(previousIso);
  if (previous && !Number.isNaN(previous.getTime()) && day(previous) === day(current)) return null;
  const age = Math.round((day(now) - day(current)) / 86_400_000);
  const time = current.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const label =
    age === 0
      ? "Today"
      : age === 1
        ? "Yesterday"
        : current.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
  return `${label} ${time}`;
}

export interface GroupCommentary {
  id: string;
  authorName: string;
  entries: readonly OpenbotChannelMessage[];
}

// Channel rows and turn-steps place commentary above the first answer, or under live activity.
export function projectGroupCommentary(entries: readonly OpenbotChannelMessage[]) {
  const turnKey = (entry: OpenbotChannelMessage) =>
    JSON.stringify([
      entry.author.kind,
      entry.author.id,
      entry.message.turnId ?? entry.id,
      entry.superseded,
    ]);
  const folded = (entry: OpenbotChannelMessage) =>
    entry.message.author === "assistant" &&
    entry.message.itemType === "commentary" &&
    !entry.message.attachments?.length &&
    entry.message.uiBlock == null &&
    entry.message.questionPrompt == null &&
    entry.message.imageGeneration == null;
  const byTurn = new Map<string, OpenbotChannelMessage[]>();
  for (const entry of entries) {
    if (!folded(entry)) continue;
    const key = turnKey(entry);
    byTurn.set(key, [...(byTurn.get(key) ?? []), entry]);
  }
  const rows = entries.filter((entry) => !folded(entry));
  const above = new Map<string, GroupCommentary>();
  const group = (key: string, items: readonly OpenbotChannelMessage[]): GroupCommentary => ({
    id: key,
    authorName: items[0]?.author.name ?? "Bot",
    entries: items,
  });
  for (const row of rows) {
    if (
      row.author.kind === "member" ||
      row.message.itemType === "commentary" ||
      (!row.message.text.trim() && !row.message.attachments?.length && row.message.uiBlock == null)
    )
      continue;
    const key = turnKey(row);
    const items = byTurn.get(key);
    if (items) {
      above.set(row.id, group(key, items));
      byTurn.delete(key);
    }
  }
  return { rows, above, pending: [...byTurn].map(([key, items]) => group(key, items)) };
}
