import { expect, it } from "vite-plus/test";
import {
  closeThreadTab,
  dockThreadTab,
  moveThreadTab,
  parseThreadTabLayout,
  readThreadTabLayout,
  writeThreadTabLayout,
  threadTabDrop,
} from "./openbotThreadTabLayout";
it("keeps chat and side tab ownership exclusive, restores docking selection, and closes to the left without changing tasks", () => {
  const layout = { open: ["a", "b", "c"], active: "b", side: ["d"] };
  expect(closeThreadTab(layout, "b", "open")).toEqual({
    open: ["a", "c"],
    active: "a",
    side: ["d"],
  });
  const side = dockThreadTab(layout, "b", "side");
  expect(side).toEqual({ open: ["a", "c"], active: null, side: ["d", "b"] });
  expect(dockThreadTab(side, "b", "open")).toEqual({
    open: ["a", "c", "b"],
    active: "b",
    side: ["d"],
  });
  expect(moveThreadTab(layout, "b", 0, "open").open).toEqual(["b", "a", "c"]);
});
it("isolates stored layouts by environment, host and agent and tolerates corrupt preferences", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const first = JSON.stringify(["environment-a", "host", "agent"]),
    second = JSON.stringify(["environment-b", "host", "agent"]);
  writeThreadTabLayout(first, { open: ["a"], side: ["b"], active: "a" }, storage);
  writeThreadTabLayout(second, { open: ["c"], side: [], active: null }, storage);
  expect(readThreadTabLayout(first, storage)).toEqual({ open: ["a"], side: ["b"], active: "a" });
  expect(readThreadTabLayout(second, storage)?.open).toEqual(["c"]);
  expect(
    parseThreadTabLayout({ open: ["a", "a", null, 45, "b"], side: ["b", "b"], active: "a" }),
  ).toEqual({ open: ["a"], side: ["b"], active: "a" });
  expect(readThreadTabLayout(first, { getItem: () => "malformed", setItem: () => {} })).toBeNull();
  expect(() =>
    writeThreadTabLayout(
      first,
      { open: [], side: [], active: null },
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
    ),
  ).not.toThrow();
});
it("uses centers in the chat strip and the leading edge for unequal-width side tabs, clamping at the row ends", () => {
  const items = [
    { id: "wide", left: 0, width: 180 },
    { id: "small", left: 184, width: 60 },
    { id: "last", left: 248, width: 60 },
  ];
  expect(threadTabDrop(items, "wide", 999, 4, "chat")).toMatchObject({ offset: 128, target: 1 });
  expect(threadTabDrop(items, "wide", 90, 4, "side")).toMatchObject({ offset: 90, target: 1 });
  expect(threadTabDrop(items, "last", -999, 4, "chat")).toMatchObject({
    offset: -248,
    target: 0,
    shifts: [
      { id: "wide", x: 64 },
      { id: "small", x: 64 },
      { id: "last", x: -248 },
    ],
  });
});
