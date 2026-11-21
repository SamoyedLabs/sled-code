// Keep ten pages in memory while allowing an explicit older-page request to reach the full history.
export function prependBotHistoryWindow<Page>(
  anchor: Page,
  older: readonly Page[],
  next: Page,
): { anchor: Page; older: readonly Page[]; shifted: boolean } {
  if (older.length < 9) return { anchor, older: [...older, next], shifted: false };
  return { anchor: older.at(-1) ?? anchor, older: [next], shifted: true };
}
