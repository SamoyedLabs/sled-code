export type OpenbotThreadTabLayout = {
  open: readonly string[];
  active: string | null;
  side: readonly string[];
};
export const THREAD_LAYOUT_STORAGE = "sled:openbot:thread-tabs:v1";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter(
              (id): id is string =>
                typeof id === "string" && id.trim().length > 0 && id.length <= 200,
            )
            .map((id) => id.trim()),
        ),
      ].slice(0, 50)
    : [];
}
export function parseThreadTabLayout(value: unknown): OpenbotThreadTabLayout | null {
  const entry = record(value);
  if (!entry) return null;
  const side = ids(entry.side);
  const open = ids(entry.open).filter((id) => !side.includes(id));
  return {
    open,
    side,
    active:
      typeof entry.active === "string" &&
      entry.active.trim().length > 0 &&
      entry.active.length <= 200
        ? entry.active
        : null,
  };
}
export function readThreadTabLayout(
  scopeKey: string,
  storage: StoragePort,
): OpenbotThreadTabLayout | null {
  try {
    return parseThreadTabLayout(
      record(JSON.parse(storage.getItem(THREAD_LAYOUT_STORAGE) ?? "{}"))?.[scopeKey],
    );
  } catch {
    return null;
  }
}
export function writeThreadTabLayout(
  scopeKey: string,
  layout: OpenbotThreadTabLayout,
  storage: StoragePort,
): void {
  try {
    const saved = record(JSON.parse(storage.getItem(THREAD_LAYOUT_STORAGE) ?? "{}")) ?? {};
    storage.setItem(
      THREAD_LAYOUT_STORAGE,
      JSON.stringify({
        ...saved,
        [scopeKey]: {
          open: [...layout.open, ...layout.side],
          side: layout.side,
          active: layout.active,
        },
      }),
    );
  } catch {
    /* Browser storage must never prevent a local tab action. */
  }
}
export function moveThreadTab(
  layout: OpenbotThreadTabLayout,
  id: string,
  index: number,
  row: "open" | "side",
): OpenbotThreadTabLayout {
  const order = layout[row].filter((other) => other !== id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  return { ...layout, [row]: order };
}
export function dockThreadTab(
  layout: OpenbotThreadTabLayout,
  id: string,
  to: "open" | "side",
): OpenbotThreadTabLayout {
  return {
    open:
      to === "open"
        ? [...layout.open.filter((other) => other !== id), id]
        : layout.open.filter((other) => other !== id),
    side:
      to === "side"
        ? [...layout.side.filter((other) => other !== id), id]
        : layout.side.filter((other) => other !== id),
    active: to === "open" ? id : layout.active === id ? null : layout.active,
  };
}
export function closeThreadTab(
  layout: OpenbotThreadTabLayout,
  id: string,
  row: "open" | "side",
): OpenbotThreadTabLayout {
  const index = layout[row].indexOf(id);
  const next = layout[row].filter((other) => other !== id);
  return {
    ...layout,
    [row]: next,
    active:
      row === "open" && layout.active === id
        ? (next[Math.max(0, index - 1)] ?? null)
        : layout.active,
  };
}
export function threadTabDrop(
  items: readonly { id: string; left: number; width: number }[],
  id: string,
  delta: number,
  gap: number,
  row: "chat" | "side",
) {
  const index = items.findIndex((item) => item.id === id),
    self = items[index],
    first = items[0],
    last = items.at(-1);
  if (!self || !first || !last) return null;
  const offset = Math.min(
    Math.max(delta, first.left - self.left),
    last.left + last.width - self.left - self.width,
  );
  const center = self.left + self.width / 2 + offset;
  const edge = offset < 0 ? self.left + offset : self.left + self.width + offset;
  const target =
    row === "chat"
      ? items.filter((item, i) =>
          i < index
            ? item.left + item.width / 2 < center
            : i > index && item.left + item.width / 2 <= center,
        ).length
      : items.filter((item, i) => i !== index && item.left + item.width / 2 < edge).length;
  const room = self.width + gap;
  return {
    offset,
    target,
    shifts: items.map((item, i) => ({
      id: item.id,
      x:
        i === index
          ? offset
          : i > index && i <= target
            ? -room
            : i < index && i >= target
              ? room
              : 0,
    })),
  };
}
export function threadRowMode(free: number) {
  return free < 48 ? "minimal" : free < 200 ? "compact" : "tabs";
}
