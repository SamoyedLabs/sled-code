import type { OpenbotWorkflowGraph } from "@t3tools/contracts";
import { ERASER_RADIUS, touches, type Box, type WfnPoint } from "./workflowInk";
export type Graph = OpenbotWorkflowGraph;
export type CanvasNode = Graph["nodes"][number];
type Range = { min: number; max: number };
// WorkflowCanvas.tsx RESIZE and workflow-node-parts.tsx BLOCK_RESIZE, unchanged.
export const RESIZE: Record<string, { width: Range; height?: Range }> = {
  text: { width: { min: 120, max: 960 } },
  prompt: { width: { min: 240, max: 640 }, height: { min: 151, max: 640 } },
  asset: { width: { min: 200, max: 480 }, height: { min: 136, max: 480 } },
  llm: { width: { min: 304, max: 720 }, height: { min: 160, max: 960 } },
  agent: { width: { min: 304, max: 720 }, height: { min: 160, max: 960 } },
  image: { width: { min: 200, max: 720 } },
  trigger: { width: { min: 240, max: 480 } },
  condition: { width: { min: 260, max: 560 } },
  output: { width: { min: 240, max: 480 } },
  approval: { width: { min: 260, max: 560 } },
  note: { width: { min: 160, max: 480 }, height: { min: 120, max: 480 } },
  shape: { width: { min: 48, max: 960 }, height: { min: 48, max: 960 } },
};
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];
const snap = (value: number, range: Range) =>
  Math.min(Math.max(Math.round(value / 8) * 8, range.min), range.max);
export function resizeNode(
  node: CanvasNode,
  box: Box,
  floor: number,
  handle: Handle,
  delta: WfnPoint,
): CanvasNode {
  const limits = RESIZE[node.kind];
  if (!limits || node.locked) return node;
  const across = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const down = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const place = (width: number, height: number) => ({
    x: across < 0 ? box.x + box.width - width : box.x,
    y: down < 0 ? box.y + box.height - height : box.y,
  });
  if (node.kind === "text" && down) {
    const base = node.size?.font ?? 24;
    const ratio =
      1 +
      (across * delta.x * box.width + down * delta.y * box.height) /
        (box.width ** 2 + box.height ** 2);
    const font = Math.min(Math.max(Math.round(base * ratio), 12), 120);
    return {
      ...node,
      at: place((box.width * font) / base, (box.height * font) / base),
      size: {
        font,
        ...(node.size?.width === undefined
          ? {}
          : { width: Math.round((node.size.width * font) / base) }),
      },
    };
  }
  let width = across ? snap(box.width + across * delta.x, limits.width) : box.width;
  let height = box.height;
  if (limits.height && down)
    height = Math.max(snap(box.height + down * delta.y, limits.height), floor);
  else if (node.kind === "image") {
    if (!across)
      width = snap((box.width * (box.height + down * delta.y)) / box.height, limits.width);
    height = (box.height * width) / box.width;
  }
  const size = limits.height
    ? {
        ...(across || node.size?.width !== undefined ? { width } : {}),
        ...(down || node.size?.height !== undefined ? { height } : {}),
      }
    : { ...node.size, width };
  return { ...node, at: place(width, height), size };
}
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };
export function alignMove(
  axis: "x" | "y",
  origin: WfnPoint,
  box: Box,
  others: readonly Box[],
  move: number,
  zoom: number,
): { delta: number; guides: Guide[] } {
  const across = axis === "x" ? "y" : "x";
  const length = (item: Box) => (axis === "x" ? item.width : item.height);
  const lines = (item: Box) => [
    item[axis],
    item[axis] + length(item) / 2,
    item[axis] + length(item),
  ];
  const moved = { ...box, [axis]: box[axis] + move };
  let best: number | undefined;
  for (const other of others)
    for (const line of lines(other))
      for (const mine of lines(moved)) {
        const gap = line - mine;
        if (Math.abs(gap) <= 6 / zoom && (best === undefined || Math.abs(gap) < Math.abs(best)))
          best = gap;
      }
  if (best === undefined)
    return { delta: Math.round((origin[axis] + move) / 8) * 8 - origin[axis], guides: [] };
  const delta = move + best,
    placed = { ...box, [axis]: box[axis] + delta };
  const guides: Guide[] = [];
  for (const line of lines(placed)) {
    const matched = others.filter((other) =>
      lines(other).some((value) => Math.abs(value - line) < 0.5),
    );
    if (!matched.length) continue;
    const span = [placed, ...matched];
    guides.push({
      axis,
      at: line,
      from: Math.min(...span.map((item) => item[across])),
      to: Math.max(
        ...span.map((item) => item[across] + (across === "x" ? item.width : item.height)),
      ),
    });
  }
  return { delta, guides };
}
export function erasedAlong(graph: Graph, from: WfnPoint, to: WfnPoint, zoom: number) {
  const radius = ERASER_RADIUS / zoom;
  const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius));
  return graph.strokes
    .filter((stroke) =>
      Array.from({ length: count + 1 }, (_, index) => ({
        x: from.x + ((to.x - from.x) * index) / count,
        y: from.y + ((to.y - from.y) * index) / count,
      })).some((at) => touches(stroke, at, radius)),
    )
    .map((stroke) => stroke.id);
}
export const CLIP_TYPE = "application/x-openbot-workflow-nodes";
export type Clip = Pick<Graph, "nodes" | "edges">;
let copied: { key: string; clip: Clip } | null = null;
const copyListeners = new Set<() => void>();
export function subscribeCanvasCopy(listener: () => void) {
  copyListeners.add(listener);
  return () => {
    copyListeners.delete(listener);
  };
}
export const readCanvasCopy = () => copied;
export const storeCanvasCopy = (value: { key: string; clip: Clip }) => {
  copied = value;
  for (const listener of copyListeners) listener();
};
export function collectNodes(graph: Graph, selection: readonly string[]): Clip {
  const nodes = graph.nodes.filter((node) => selection.includes(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}
export function pasteNodes(
  graph: Graph,
  clip: Clip,
  shift: WfnPoint,
  newId: () => string,
): { graph: Graph; ids: string[] } | null {
  if (
    !clip.nodes.length ||
    graph.nodes.length + clip.nodes.length > 200 ||
    graph.edges.length + clip.edges.length > 400
  )
    return null;
  const ids = new Map(clip.nodes.map((node) => [node.id, newId()]));
  const nodes = clip.nodes.map((node) => ({
    ...node,
    id: ids.get(node.id)!,
    locked: false,
    at: { x: node.at.x + shift.x, y: node.at.y + shift.y },
  }));
  const edges = clip.edges.flatMap((edge) => {
    const from = ids.get(edge.from),
      to = ids.get(edge.to);
    return from && to ? [{ ...edge, id: newId(), from, to }] : [];
  });
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] },
    ids: nodes.map((node) => node.id),
  };
}
