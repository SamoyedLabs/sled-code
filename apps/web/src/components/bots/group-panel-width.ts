export function groupPanelBounds(available: number, settings: boolean) {
  const min = settings ? 360 : 220;
  return {
    min,
    max: Math.min(1600, Math.max(min, available - 96)),
    defaultValue: settings ? 360 : Math.round(available * 0.5),
  };
}
export function clampGroupPanelWidth(value: number, bounds: { min: number; max: number }) {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}
export function groupPanelKeyWidth(
  key: string,
  value: number,
  bounds: { min: number; max: number },
  rtl: boolean,
) {
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key === (rtl ? "ArrowRight" : "ArrowLeft")) return clampGroupPanelWidth(value + 12, bounds);
  if (key === (rtl ? "ArrowLeft" : "ArrowRight")) return clampGroupPanelWidth(value - 12, bounds);
  return null;
}
