import { expect, it } from "vite-plus/test";
import { clampGroupPanelWidth, groupPanelBounds, groupPanelKeyWidth } from "./group-panel-width";

it("uses source settings/files defaults while reserving 96px and capping large panels", () => {
  expect(groupPanelBounds(1000, true)).toEqual({ min: 360, max: 904, defaultValue: 360 });
  expect(groupPanelBounds(1000, false)).toEqual({ min: 220, max: 904, defaultValue: 500 });
  expect(groupPanelBounds(2400, false).max).toBe(1600);
  expect(groupPanelBounds(200, true).max).toBe(360);
});

it("clamps restored and dragged widths to the current available space", () => {
  const bounds = groupPanelBounds(900, false);
  expect(clampGroupPanelWidth(1400, bounds)).toBe(804);
  expect(clampGroupPanelWidth(12, bounds)).toBe(220);
  expect(clampGroupPanelWidth(450.6, bounds)).toBe(451);
});

it("supports 12px keyboard resizing, RTL inversion and Home/End bounds", () => {
  const bounds = groupPanelBounds(1000, false);
  expect(groupPanelKeyWidth("ArrowLeft", 500, bounds, false)).toBe(512);
  expect(groupPanelKeyWidth("ArrowRight", 500, bounds, false)).toBe(488);
  expect(groupPanelKeyWidth("ArrowLeft", 500, bounds, true)).toBe(488);
  expect(groupPanelKeyWidth("ArrowRight", 500, bounds, true)).toBe(512);
  expect(groupPanelKeyWidth("Home", 500, bounds, false)).toBe(220);
  expect(groupPanelKeyWidth("End", 500, bounds, true)).toBe(904);
  expect(groupPanelKeyWidth("ArrowLeft", 900, bounds, false)).toBe(904);
  expect(groupPanelKeyWidth("Enter", 500, bounds, false)).toBeNull();
});
