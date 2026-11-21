import type { BrowserTab } from "./types";
import type { BrowserHistoryEntry } from "./browser-suggestions";
export interface BrowserSession {
  order: string[];
  pending: { afterId?: string; index?: number } | undefined;
  closed: { url: string; index: number }[];
  history: BrowserHistoryEntry[];
  shown: Record<string, { url: string; title: string }>;
}
export function emptyBrowserSession(): BrowserSession {
  return { order: [], pending: undefined, closed: [], history: [], shown: {} };
}
export function syncBrowserSession(
  current: BrowserSession,
  tabs: readonly BrowserTab[],
): BrowserSession {
  const listed = new Set(tabs.map((t) => t.id));
  const order = current.order.filter((id) => listed.has(id));
  let pending = current.pending;
  for (const tab of tabs) {
    if (current.order.includes(tab.id)) continue;
    const after = pending?.afterId === undefined ? -1 : order.indexOf(pending.afterId);
    if (after >= 0) order.splice(after + 1, 0, tab.id);
    else if (pending?.index !== undefined)
      order.splice(Math.min(pending.index, order.length), 0, tab.id);
    else order.push(tab.id);
    pending = undefined;
  }
  let history = current.history;
  const shown: BrowserSession["shown"] = {};
  for (const tab of tabs) {
    const previous = current.shown[tab.id];
    shown[tab.id] = { url: tab.url, title: tab.title };
    if (!/^https?:\/\//i.test(tab.url)) continue;
    const old = history.find((row) => row.url === tab.url);
    if (previous?.url !== tab.url)
      history = [
        { url: tab.url, title: tab.title || old?.title || "", visits: (old?.visits ?? 0) + 1 },
        ...history.filter((row) => row.url !== tab.url),
      ].slice(0, 200);
    else if (previous.title !== tab.title && tab.title)
      history = history.map((row) => (row.url === tab.url ? { ...row, title: tab.title } : row));
  }
  return { ...current, order, pending, history, shown };
}
export function orderedTabs(session: BrowserSession, tabs: readonly BrowserTab[]) {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  return [
    ...session.order.flatMap((id) => {
      const tab = byId.get(id);
      return tab ? [tab] : [];
    }),
    ...tabs.filter((t) => !session.order.includes(t.id)),
  ];
}
export function moveTab(
  session: BrowserSession,
  tabs: readonly BrowserTab[],
  id: string,
  index: number,
) {
  const order = tabs.map((t) => t.id);
  const from = order.indexOf(id);
  if (from < 0) return session;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  return { ...session, order };
}
export function rememberClosed(
  session: BrowserSession,
  tabs: readonly BrowserTab[],
  ids: readonly string[],
) {
  let closed = session.closed;
  for (const id of ids) {
    const index = tabs.findIndex((t) => t.id === id);
    const tab = tabs[index];
    if (tab && /^https?:\/\//i.test(tab.url))
      closed = [{ url: tab.url, index }, ...closed].slice(0, 25);
  }
  return { ...session, closed };
}
