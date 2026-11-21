import { expect, it } from "vite-plus/test";
import { sidebarDragScrollSpeed } from "./openbotSidebarDragMotion";

it("uses source edge acceleration and caps scrolling outside the list", () => {
  expect(sidebarDragScrollSpeed(100, 500, 100)).toBe(-12);
  expect(sidebarDragScrollSpeed(100, 500, 120)).toBe(-6);
  expect(sidebarDragScrollSpeed(100, 500, 140)).toBe(0);
  expect(sidebarDragScrollSpeed(100, 500, 300)).toBe(0);
  expect(sidebarDragScrollSpeed(100, 500, 480)).toBe(6);
  expect(sidebarDragScrollSpeed(100, 500, 500)).toBe(12);
  expect(sidebarDragScrollSpeed(100, 500, 900)).toBe(12);
});

it("shrinks the edge band for short lists and cannot divide by a collapsed list", () => {
  expect(sidebarDragScrollSpeed(100, 180, 110)).toBe(-6);
  expect(sidebarDragScrollSpeed(100, 180, 170)).toBe(6);
  expect(sidebarDragScrollSpeed(100, 100, 100)).toBe(0);
});
