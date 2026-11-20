/** Keep selection order independent of network completion, without replacing any draft identity. */
export function insertBotDrafts(
  current: readonly string[],
  ids: readonly string[],
  beforeId?: string,
) {
  const incoming = [...new Set(ids)].filter((id) => !current.includes(id));
  const at = beforeId === undefined ? -1 : current.indexOf(beforeId);
  return [
    ...current.slice(0, at < 0 ? current.length : at),
    ...incoming,
    ...current.slice(at < 0 ? current.length : at),
  ].slice(0, 10);
}
export function reorderBotDrafts(current: readonly string[], ids: readonly string[]) {
  return ids.length === current.length &&
    new Set(ids).size === current.length &&
    ids.every((id) => current.includes(id))
    ? [...ids]
    : current;
}
export function moveBotDraft(ids: readonly string[], id: string, targetId: string) {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const result = [...ids];
  result.splice(from, 1);
  result.splice(to, 0, id);
  return result;
}
