import { expect, it } from "vite-plus/test";
import {
  alignMove,
  collectNodes,
  erasedAlong,
  pasteNodes,
  resizeNode,
  type Graph,
} from "./workflowCanvasModel";
import { routineScheduleFromDraft, routineScheduleToDraft } from "./routineScheduleDraft";
const graph: Graph = {
  nodes: [
    {
      id: "trigger",
      kind: "trigger",
      at: { x: 0, y: 0 },
      fields: { trigger: "schedule" },
      schedule: { kind: "weekly", weekday: 1, time: "09:00" },
      locked: true,
    },
    { id: "condition", kind: "condition", at: { x: 300, y: 0 }, fields: { rule: "Ready?" } },
    { id: "output", kind: "output", at: { x: 600, y: 0 }, fields: { target: "notify" } },
  ],
  edges: [
    { id: "in", from: "trigger", to: "condition", type: "text" },
    { id: "yes", from: "condition", to: "output", type: "text", branch: "yes" },
  ],
  strokes: [],
};
it("copies only internal edges with fresh identities, retaining branch and schedule data while respecting graph bounds", () => {
  const clip = collectNodes(graph, ["condition", "output"]);
  expect(clip.edges.map((edge) => edge.id)).toEqual(["yes"]);
  let next = 0;
  const pasted = pasteNodes(graph, clip, { x: 32, y: 32 }, () => `new-${++next}`)!;
  expect(pasted.ids).toEqual(["new-1", "new-2"]);
  expect(pasted.graph.edges.at(-1)).toEqual({
    id: "new-3",
    from: "new-1",
    to: "new-2",
    type: "text",
    branch: "yes",
  });
  const schedule = pasteNodes(
    graph,
    collectNodes(graph, ["trigger"]),
    { x: 32, y: 32 },
    () => "schedule-copy",
  )!.graph.nodes.at(-1)!;
  expect(schedule.schedule).toEqual(graph.nodes[0]!.schedule);
  expect(schedule.locked).toBe(false);
  expect(
    pasteNodes(
      { ...graph, nodes: Array.from({ length: 200 }, () => graph.nodes[0]!) },
      clip,
      { x: 0, y: 0 },
      () => "no-room",
    ),
  ).toBeNull();
});
it("resizes around the opposite edge, snaps within source bounds, preserves image aspect and scales text font", () => {
  const node = { id: "note", kind: "note", at: { x: 100, y: 100 }, fields: {} };
  expect(
    resizeNode(node, { x: 100, y: 100, width: 240, height: 240 }, 120, "nw", { x: 80, y: 800 }),
  ).toMatchObject({ at: { x: 180, y: 220 }, size: { width: 160, height: 120 } });
  const image = resizeNode(
    { ...node, kind: "image" },
    { x: 100, y: 100, width: 320, height: 160 },
    0,
    "n",
    { x: 0, y: -80 },
  );
  expect(image.size?.width).toBe(480);
  expect(image.at.y).toBe(20);
  const text = resizeNode(
    { ...node, kind: "text", size: { font: 24, width: 200 } },
    { x: 100, y: 100, width: 200, height: 100 },
    0,
    "se",
    { x: 200, y: 100 },
  );
  expect(text.size).toEqual({ font: 48, width: 400 });
  expect(
    resizeNode({ ...node, locked: true }, { x: 100, y: 100, width: 240, height: 240 }, 0, "se", {
      x: 500,
      y: 500,
    }).size,
  ).toBeUndefined();
});
it("finds fast eraser crossings between events and aligns a group using screen-scaled source tolerance", () => {
  const drawing: Graph = {
    ...graph,
    strokes: [
      {
        id: "line",
        brush: "pen",
        color: "ink",
        width: 2.5,
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
      },
    ],
  };
  expect(erasedAlong(drawing, { x: 0, y: 50 }, { x: 100, y: 50 }, 1)).toEqual(["line"]);
  expect(erasedAlong(drawing, { x: 0, y: 150 }, { x: 100, y: 150 }, 1)).toEqual([]);
  expect(
    alignMove(
      "x",
      { x: 0, y: 0 },
      { x: 0, y: 0, width: 100, height: 100 },
      [{ x: 202, y: 0, width: 100, height: 100 }],
      100,
      1,
    ),
  ).toMatchObject({ delta: 102, guides: [{ axis: "x", at: 202, from: 0, to: 100 }] });
});
it("retains overnight hourly windows and yearly dates through the exact source schedule draft conversion", () => {
  const overnight = {
    kind: "hourly" as const,
    everyHours: 2,
    days: [1, 2, 3, 4, 5],
    window: { start: "20:30", end: "04:30" },
  };
  const saved = routineScheduleFromDraft(overnight);
  expect(saved).toEqual({ kind: "custom", expression: "30 20-23/2,0-4/2 * * 1,2,3,4,5" });
  expect(routineScheduleFromDraft(routineScheduleToDraft(saved))).toEqual(saved);
  expect(routineScheduleFromDraft({ kind: "yearly", month: 2, day: 29, time: "09:00" })).toEqual({
    kind: "advanced",
    months: [2],
    days: { kind: "days-of-month", days: [29] },
    time: { kind: "at-time", time: "09:00" },
  });
});
