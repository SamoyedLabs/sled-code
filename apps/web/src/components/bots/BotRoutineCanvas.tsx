import { useId, useState } from "react";
import type { OpenbotRoutineFlowCanvas } from "@t3tools/contracts";
import { cn } from "../../lib/utils";

type Point = { x: number; y: number };
export function BotRoutineCanvas({
  canvas,
  agents,
  selected,
  disabled,
  onSelect,
  onMove,
}: {
  canvas: typeof OpenbotRoutineFlowCanvas.Type;
  agents: readonly { id: string; name: string }[];
  selected: string;
  disabled: boolean;
  onSelect: (nodeKey: string) => void;
  onMove: (nodeKey: string, point: Point) => void;
}) {
  const pattern = useId();
  const [drag, setDrag] = useState<{
    key: string;
    start: Point;
    origin: Point;
    point: Point;
  } | null>(null);
  const agentIds = new Set([
    canvas.agentId,
    ...canvas.placedAgentIds,
    ...canvas.links.flatMap((link) => [link.fromAgentId, link.toAgentId]),
  ]);
  const nodes = [
    ...agents
      .filter((agent) => agentIds.has(agent.id))
      .map((agent) => ({ key: `agent:${agent.id}`, label: agent.name, kind: "Bot" })),
    ...canvas.routines.map((flow) => ({
      key: `routine:${flow.routine.id}`,
      label: flow.routine.name || "Untitled routine",
      kind: flow.routine.active ? "Scheduled" : "Paused",
    })),
  ].map((node, index) => ({
    ...node,
    ...(canvas.positions.find((position) => position.nodeKey === node.key) ?? {
      x: (index % 3) * 260,
      y: Math.floor(index / 3) * 150,
    }),
  }));
  const left = Math.min(0, ...nodes.map((node) => node.x)) - 50;
  const top = Math.min(0, ...nodes.map((node) => node.y)) - 50;
  const width = Math.max(850, ...nodes.map((node) => node.x + 240)) - left;
  const height = Math.max(360, ...nodes.map((node) => node.y + 110)) - top;
  const current = (key: string) =>
    drag?.key === key ? drag.point : nodes.find((node) => node.key === key);
  const edges = [
    ...canvas.links.map((link) => ({
      id: link.id,
      from: `agent:${link.fromAgentId}`,
      to: `agent:${link.toAgentId}`,
    })),
    ...canvas.routines.map((flow) => ({
      id: `schedule:${flow.routine.id}`,
      from: `routine:${flow.routine.id}`,
      to: `agent:${canvas.agentId}`,
    })),
  ];
  const point = (event: React.PointerEvent<SVGSVGElement | SVGGElement>): Point => {
    const svg =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-muted/10">
      <svg
        role="group"
        aria-label="Routine canvas"
        viewBox={`${left} ${top} ${width} ${height}`}
        className="min-h-80 w-full touch-none"
      >
        <defs>
          <pattern id={pattern} width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="fill-muted-foreground/20" />
          </pattern>
        </defs>
        <rect x={left} y={top} width={width} height={height} fill={`url(#${pattern})`} />
        {edges.map((edge) => {
          const from = current(edge.from),
            to = current(edge.to);
          if (!from || !to) return null;
          return (
            <path
              key={edge.id}
              d={`M ${from.x + 210} ${from.y + 36} C ${from.x + 270} ${from.y + 36}, ${to.x - 60} ${to.y + 36}, ${to.x} ${to.y + 36}`}
              fill="none"
              className="stroke-primary/45"
              strokeWidth="2"
            />
          );
        })}
        {nodes.map((node) => {
          const p = current(node.key)!;
          return (
            <g
              key={node.key}
              role="button"
              tabIndex={0}
              aria-label={`${node.kind}: ${node.label}. Use arrow keys to move.`}
              transform={`translate(${p.x} ${p.y})`}
              className="cursor-grab outline-none focus-visible:stroke-primary"
              onClick={() => onSelect(node.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.key);
                  return;
                }
                if (disabled) return;
                const delta: Record<string, Point> = {
                  ArrowLeft: { x: -24, y: 0 },
                  ArrowRight: { x: 24, y: 0 },
                  ArrowUp: { x: 0, y: -24 },
                  ArrowDown: { x: 0, y: 24 },
                };
                const d = delta[event.key];
                if (d) {
                  event.preventDefault();
                  onMove(node.key, {
                    x: Math.max(-1000000, Math.min(1000000, p.x + d.x)),
                    y: Math.max(-1000000, Math.min(1000000, p.y + d.y)),
                  });
                }
              }}
              onPointerDown={(event) => {
                if (disabled || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ key: node.key, start: point(event), origin: p, point: p });
              }}
              onPointerMove={(event) => {
                if (drag?.key !== node.key) return;
                const cursor = point(event);
                setDrag({
                  ...drag,
                  point: {
                    x: Math.max(
                      -1000000,
                      Math.min(1000000, drag.origin.x + cursor.x - drag.start.x),
                    ),
                    y: Math.max(
                      -1000000,
                      Math.min(1000000, drag.origin.y + cursor.y - drag.start.y),
                    ),
                  },
                });
              }}
              onPointerUp={(event) => {
                if (drag?.key !== node.key) return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (
                  Math.abs(drag.point.x - drag.origin.x) + Math.abs(drag.point.y - drag.origin.y) >
                  2
                )
                  onMove(node.key, drag.point);
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
            >
              <rect
                width="210"
                height="74"
                rx="12"
                className={cn(
                  "fill-background stroke-border",
                  selected === node.key && "stroke-primary",
                )}
                strokeWidth={selected === node.key ? 2 : 1}
              />
              <text x="16" y="25" className="fill-muted-foreground text-xs">
                {node.kind}
              </text>
              <text x="16" y="49" className="fill-foreground text-sm font-medium">
                {node.label.length > 25 ? node.label.slice(0, 24) + "…" : node.label}
              </text>
              <title>{node.label}</title>
            </g>
          );
        })}
      </svg>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        {disabled
          ? "View your routines and connected bots."
          : "Drag a card to arrange it. Select a card to edit its connections below."}
      </p>
    </div>
  );
}
