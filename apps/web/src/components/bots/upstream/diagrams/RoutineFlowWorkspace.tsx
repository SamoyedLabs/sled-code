/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot DiagramView classes live in diagrams.css. */
import {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { EnvironmentId, OpenbotAgent } from "@t3tools/contracts";
import {
  Clock3,
  Webhook,
  Plus,
  Minus,
  Scan,
  PanelRight,
  ChevronRight,
  Play,
  X,
  Check,
  RefreshCw,
} from "lucide-react";
import { DiagramInspector, RoutineWeek } from "./DiagramInspector";
import { DiagramChatPanel } from "./DiagramChatPanel";
import { DiagramNewAgentCard } from "./DiagramNewAgentCard";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { openbot } from "../../../../state/openbot";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useBotRoutineDiscovery, useBotRoutineFlows } from "../../useBotRoutines";
import { SourceAgentAvatar } from "../../SourceAgentAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { useSourceSettingsAdmin } from "../settings/useSourceSettingsAdmin";
import { SourceSelect } from "../provider/SourceSelect";
import { menuMotionRef } from "../openbotMenuMotion";
import { useMediaQuery } from "../../../../hooks/useMediaQuery";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { observeResize } from "../../../../lib/observeResize";
import { routineScheduleToDraft, type RoutineSchedule } from "../settings/routine-schedule-draft";
import { clockLabel, daysLabel } from "../settings/RoutineSchedulePicker";
import {
  routineFlowDiagram,
  agentIdOfNode,
  routineIdOfNode,
  isRoutineStartEdge,
} from "./routine-flow-diagram";
import {
  diagramBounds,
  diagramConnectionProblem,
  diagramEdgePath,
  diagramEdgeArrow,
  diagramInputPort,
  diagramOutputPort,
  diagramRoutineSteps,
  diagramExecutionSteps,
  diagramRoutineColor,
  diagramRunOf,
  diagramAgentTask,
  diagramLatestRun,
  diagramRoutinesReaching,
  diagramEdgeCarries,
} from "./diagram-graph";
import type { Diagram, DiagramNode, DiagramPoint } from "./diagram-model";
import "./diagrams.css";
import "./diagrams-adapter.css";
import { m } from "../../../../i18n/messages";
import { T, msg, useGT } from "gt-react";

type Agent = typeof OpenbotAgent.Type;
type Camera = DiagramPoint & { scale: number };
type Gesture =
  | { kind: "pan"; start: DiagramPoint; camera: Camera }
  | { kind: "node"; id: string; start: DiagramPoint; origin: DiagramPoint };
const flag = (yes: boolean) => (yes ? "" : undefined);
const snap = (point: DiagramPoint) => ({
  x: Math.max(-1000000, Math.min(1000000, Math.round(point.x / 8) * 8)),
  y: Math.max(-1000000, Math.min(1000000, Math.round(point.y / 8) * 8)),
});
const date = (text: string | null) =>
  text
    ? new Date(text).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not recorded";

export function RoutineFlowWorkspace({
  environmentId,
  hostId,
  agentId,
  onCreateRoutine,
  onEditRoutine,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  onCreateRoutine: (agentId: string) => void;
  onEditRoutine: (agentId: string, routineId: string) => void;
}) {
  const gt = useGT();
  const discovery = useBotRoutineDiscovery(environmentId, hostId);
  const c = useBotRoutineFlows(environmentId, hostId, agentId);
  const admin = useSourceSettingsAdmin(environmentId, hostId);
  const runCommand = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const [newAgentAt, setNewAgentAt] = useState<{
    screen: DiagramPoint;
    world: DiagramPoint;
  } | null>(null);
  const [placed, setPlaced] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, DiagramPoint>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [inspector, setInspector] = useState(true);
  const [source, setSource] = useState<string | null>(null);
  const [pointer, setPointer] = useState<DiagramPoint | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [settling, setSettling] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const gesture = useRef<Gesture | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const menuAt = useRef<{ screen: DiagramPoint; world: DiagramPoint }>({
    screen: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
  });
  const suppressClick = useRef(false);
  const owner = discovery.agents.find((a) => a.id === agentId);
  const diagram = c.canvas
    ? routineFlowDiagram(
        { ...c.canvas, placedAgentIds: [...new Set([...c.canvas.placedAgentIds, ...placed])] },
        discovery.agents,
        moved,
      )
    : null;
  const routines = diagram?.nodes.filter((n) => n.kind === "routine") ?? [];
  const empty = diagram?.nodes.every((n) => n.kind === "agent" && n.agentId === agentId) ?? true;
  const focus =
    picked === null
      ? null
      : picked && routines.some((node) => node.id === picked)
        ? picked
        : diagram
          ? (diagramLatestRun(diagram)?.routineNodeId ?? null)
          : null;
  const run = diagram ? diagramRunOf(diagram, focus) : null;
  const writable = c.canWrite;
  const routineOwners = new Set(c.canvas?.routines.map((r) => r.routine.agentId) ?? []);
  const select = (node: DiagramNode) => {
    setSelectedEdge(null);
    setSelected(node.id);
    setInspector(true);
    if (node.kind === "routine") setPicked(node.id);
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewport.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const world = (p: DiagramPoint) => ({
    x: (p.x - camera.x) / camera.scale,
    y: (p.y - camera.y) / camera.scale,
  });
  const fit = (current: Diagram, animate = false) => {
    const v = viewport.current;
    if (!v) return;
    const b = diagramBounds(current.nodes);
    const scale = Math.min(
      1,
      Math.max(0.25, Math.min((v.clientWidth - 128) / b.width, (v.clientHeight - 128) / b.height)),
    );
    setSettling(animate && !reducedMotion);
    setCamera({
      x: (v.clientWidth - b.width * scale) / 2 - b.x * scale,
      y: (v.clientHeight - b.height * scale) / 2 - b.y * scale,
      scale,
    });
  };
  const ready = Boolean(diagram);
  const fitInitial = useStableCallback(() => {
    const v = viewport.current;
    if (!initialized.current && diagram && v?.clientWidth && v.clientHeight) {
      fit(diagram);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fit the external viewport once it has real data and dimensions; preserve the user's camera afterwards.
  useLayoutEffect(() => {
    const v = viewport.current;
    if (!v || !ready || empty) return;
    return observeResize(v, fitInitial);
  }, [ready, empty, fitInitial]);
  const zoom = (factor: number, at?: DiagramPoint) => {
    initialized.current = true;
    setSettling(!at && !reducedMotion);
    const v = viewport.current;
    if (!v) return;
    const point = at ?? { x: v.clientWidth / 2, y: v.clientHeight / 2 };
    setCamera((old) => {
      const scale = Math.max(0.25, Math.min(2, old.scale * factor));
      return {
        scale,
        x: point.x - ((point.x - old.x) * scale) / old.scale,
        y: point.y - ((point.y - old.y) * scale) / old.scale,
      };
    });
  };
  const wheel = useStableCallback((e: WheelEvent) => {
    e.preventDefault();
    initialized.current = true;
    setSettling(false);
    if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), local(e));
    else
      setCamera((old) => ({
        ...old,
        x: old.x - (e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX),
        y: old.y - (e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY),
      }));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The canvas owns wheel pan/pinch and must opt out of passive document scrolling.
  useEffect(() => {
    const v = viewport.current;
    if (!v || !ready || empty) return;
    v.addEventListener("wheel", wheel, { passive: false });
    return () => v.removeEventListener("wheel", wheel);
  }, [ready, empty, wheel]);
  const moveNode = (id: string, p: DiagramPoint) => {
    setMoved((old) => ({ ...old, [id]: p }));
  };
  const savePosition = async (id: string, p: DiagramPoint) => {
    const saved = await c.act({
      operation: "routineFlow.savePosition",
      agentId,
      nodeKey: id,
      ...p,
    });
    setMoved((old) => {
      if (old[id]?.x !== p.x || old[id]?.y !== p.y) return old;
      const next = { ...old };
      delete next[id];
      return next;
    });
    return saved;
  };
  const placeAgent = async (id: string, point: DiagramPoint) => {
    setPlaced((old) => (old.includes(id) ? old : [...old, id]));
    moveNode(`agent:${id}`, point);
    const saved = await savePosition(`agent:${id}`, point);
    setPlaced((old) => old.filter((entry) => entry !== id));
    return saved;
  };
  const connect = async (target: string) => {
    if (!diagram || !source || !writable) return;
    const from = source;
    setSource(null);
    setPointer(null);
    const problem = diagramConnectionProblem(
      diagram.nodes,
      focus ? diagram.edges.filter((edge) => diagramEdgeCarries(edge, focus)) : diagram.edges,
      from,
      target,
    );
    if (problem) {
      setMessage(
        {
          "same-node": "Choose another agent.",
          "into-routine": "Routines start a flow; they cannot receive answers.",
          duplicate: "These cards are already connected.",
          cycle: "That connection would create a cycle.",
        }[problem],
      );
      return;
    }
    const routineId = routineIdOfNode(focus),
      fromAgentId = agentIdOfNode(from),
      toAgentId = agentIdOfNode(target);
    if (!routineId || !fromAgentId || !toAgentId) {
      setMessage(gt("Choose a routine, then connect one agent’s output to another agent’s input."));
      return;
    }
    const ok = await c.act({ operation: "routineFlow.connect", routineId, fromAgentId, toAgentId });
    setMessage(ok ? gt("Connected.") : gt("The connection was not saved."));
  };
  const removeEdge = async (id: string) => {
    if (isRoutineStartEdge(id)) return;
    await c.act({ operation: "routineFlow.disconnect", linkId: id });
    setSelectedEdge((selected) => (selected === id ? null : selected));
  };
  const removeNode = async (node: DiagramNode) => {
    if (node.kind !== "agent" || node.agentId === agentId || routineOwners.has(node.agentId))
      return;
    const links =
      c.canvas?.links.filter(
        (link) =>
          link.toAgentId === node.agentId && (!focus || `routine:${link.routineId}` === focus),
      ) ?? [];
    for (const link of links)
      if (!(await c.act({ operation: "routineFlow.disconnect", linkId: link.id }))) return;
    if (await c.act({ operation: "routineFlow.removePosition", agentId, nodeKey: node.id })) {
      setMoved((old) => {
        const next = { ...old };
        delete next[node.id];
        return next;
      });
      setSelected(null);
    }
  };
  const saveTask = async (node: DiagramNode, routineNodeId: string, instruction: string) => {
    const routine = c.canvas?.routines.find(
      (entry) => `routine:${entry.routine.id}` === routineNodeId,
    )?.routine;
    if (!routine || node.kind !== "agent") return;
    try {
      if (routine.agentId === node.agentId) {
        if (routine.trigger.kind === "webhook" || routine.trigger.schedule.kind === "once")
          await admin.execute({
            operation: "events.save",
            ...(routine.trigger.kind === "schedule" && routine.trigger.schedule.kind === "once"
              ? { includeOneTime: true }
              : {}),
            ...routine,
            owner: { kind: "agent", id: routine.agentId },
            instruction,
          });
        else
          await admin.execute({
            operation: "routine.update",
            agentId: routine.agentId,
            routineId: routine.id,
            input: { instruction },
          });
        c.refresh();
      } else
        for (const link of c.canvas?.links.filter(
          (l) => l.toAgentId === node.agentId && l.routineId === routine.id,
        ) ?? [])
          await c.act({ operation: "routineFlow.updateLink", linkId: link.id, instruction });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : gt("The task could not be saved."));
    }
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      !(e.target instanceof Element) ||
      e.target.closest(
        "[data-diagram-control], [data-diagram-port], [data-diagram-overlay], [data-diagram-edge]",
      )
    )
      return;
    const point = local(e),
      id = e.target.closest("[data-diagram-node]")?.getAttribute("data-diagram-node");
    const node = diagram?.nodes.find((n) => n.id === id);
    initialized.current = true;
    setSettling(false);
    if (node) {
      select(node);
      if (!writable) return;
      gesture.current = { kind: "node", id: node.id, start: point, origin: node.position };
    } else {
      setSelected(null);
      setSelectedEdge(null);
      setSource(null);
      gesture.current = { kind: "pan", start: point, camera };
    }
    suppressClick.current = false;
    e.target.closest<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (source) setPointer(world(p));
    const g = gesture.current;
    if (!g) return;
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (Math.hypot(dx, dy) < 4 && !suppressClick.current) return;
    suppressClick.current = true;
    if (g.kind === "pan") setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
    else
      moveNode(
        g.id,
        snap({ x: g.origin.x + dx / camera.scale, y: g.origin.y + dy / camera.scale }),
      );
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (g?.kind === "node" && suppressClick.current) {
      const p = local(e);
      void savePosition(
        g.id,
        snap({
          x: g.origin.x + (p.x - g.start.x) / camera.scale,
          y: g.origin.y + (p.y - g.start.y) / camera.scale,
        }),
      );
    }
  };
  const startRoutine = (nodeId: string) => {
    const routine = c.canvas?.routines.find(
      (entry) => `routine:${entry.routine.id}` === nodeId,
    )?.routine;
    if (!routine) return;
    setPicked(nodeId);
    setRunning(true);
    setMessage("");
    const started =
      routine.trigger.kind === "webhook"
        ? admin.execute({
            operation: "events.test",
            owner: { kind: "agent", id: routine.agentId },
            id: routine.id,
          })
        : runCommand({
            environmentId,
            input: {
              hostId,
              request: {
                operation: "routine.test",
                agentId: routine.agentId,
                routineId: routine.id,
              },
            },
          }).then((result) => {
            if (result._tag === "Failure") throw new Error("The host refused the routine run.");
            return result.value;
          });
    void started
      .then(() => c.refresh())
      .catch((cause: unknown) =>
        setMessage(cause instanceof Error ? cause.message : gt("The routine could not start.")),
      )
      .finally(() => setRunning(false));
  };
  const actionError = c.error ?? discovery.error;
  if (!diagram)
    return (
      <main className="diagram-view diagram-flows-notice">
        {actionError ? (
          <p role="alert">{actionError}</p>
        ) : (
          <p>{c.loading ? gt("Loading routines…") : gt("Choose an agent to view its routines.")}</p>
        )}
      </main>
    );
  const current = diagram;
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  const steps = focus
    ? diagramRoutineSteps(current.edges, focus)
    : diagramExecutionSteps(current.nodes, current.edges);
  const previewSource = source ? byId.get(source) : undefined;
  const targetRoutine = focus ?? routines[0]?.id;
  return (
    <main
      className="diagram-view"
      aria-label={gt("Routine canvas for {value}", { value: owner?.name ?? agentId })}
    >
      <header className="diagram-view-header">
        {owner ? <SourceAgentAvatar agent={owner} size={18} /> : null}
        <h1 className="diagram-view-title">{owner?.name ?? gt("Routines")}</h1>
        <span className="diagram-view-actions">
          {targetRoutine && (
            <SourceButton
              size="xs"
              disabled={running || !writable}
              onClick={() => startRoutine(targetRoutine)}
            >
              <Play />
              <T>Run now</T>
            </SourceButton>
          )}
          <SourceButton
            variant="ghost"
            aria-label={gt("Refresh routines")}
            disabled={c.busy}
            onClick={c.refresh}
          >
            <RefreshCw />
          </SourceButton>
          {!empty && (
            <SourceButton
              variant="ghost"
              className="header-panel-toggle"
              aria-label={inspector ? gt("Close routine details") : gt("Routine details")}
              aria-expanded={inspector}
              onClick={() => setInspector(!inspector)}
            >
              {inspector ? <ChevronRight /> : <PanelRight />}
            </SourceButton>
          )}
        </span>
      </header>
      <div className="diagram-view-body" data-inspector={inspector && !empty ? "open" : undefined}>
        <div className="diagram-view-canvas">
          {empty ? (
            <RoutineEmpty onCreate={() => onCreateRoutine(agentId)} />
          ) : (
            <div className="diagram-board">
              <ContextMenu.Root>
                <ContextMenu.Trigger render={<div className="diagram-board-menu-area" />}>
                  <div
                    ref={viewport}
                    className="diagram-board-viewport"
                    aria-label={gt("Canvas for {value}", { value: owner?.name ?? agentId })}
                    role="group"
                    tabIndex={0}
                    style={
                      {
                        "--diagram-grid-x": `${camera.x}px`,
                        "--diagram-grid-y": `${camera.y}px`,
                        "--diagram-grid-size": `${24 * camera.scale}px`,
                      } as CSSProperties
                    }
                    onContextMenu={(e) => {
                      menuAt.current = { screen: local(e), world: snap(world(local(e))) };
                    }}
                    onPointerDown={down}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={() => {
                      gesture.current = null;
                    }}
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Delete" || e.key === "Backspace") &&
                        writable &&
                        !(e.target instanceof HTMLInputElement) &&
                        !(e.target instanceof HTMLTextAreaElement)
                      ) {
                        e.preventDefault();
                        if (selectedEdge) void removeEdge(selectedEdge);
                        else {
                          const node = current.nodes.find((n) => n.id === selected);
                          if (node) void removeNode(node);
                        }
                      } else if (e.key === "Escape") {
                        setSource(null);
                        setPointer(null);
                        setSelected(null);
                      } else if (e.target === e.currentTarget) {
                        if (e.key === "+" || e.key === "=") {
                          e.preventDefault();
                          zoom(1.2);
                          return;
                        }
                        if (e.key === "-") {
                          e.preventDefault();
                          zoom(1 / 1.2);
                          return;
                        }
                        if (e.key === "0") {
                          e.preventDefault();
                          fit(current, true);
                          return;
                        }
                        const d: Record<string, DiagramPoint> = {
                          ArrowLeft: { x: 48, y: 0 },
                          ArrowRight: { x: -48, y: 0 },
                          ArrowUp: { x: 0, y: 48 },
                          ArrowDown: { x: 0, y: -48 },
                        };
                        if (d[e.key]) {
                          e.preventDefault();
                          initialized.current = true;
                          setSettling(!reducedMotion);
                          setCamera((old) => ({
                            ...old,
                            x: old.x + d[e.key]!.x,
                            y: old.y + d[e.key]!.y,
                          }));
                        }
                      }
                    }}
                  >
                    <div
                      className="diagram-board-world"
                      data-settling={flag(settling)}
                      onTransitionEnd={(event) => {
                        if (event.target === event.currentTarget) setSettling(false);
                      }}
                      style={{
                        transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`,
                      }}
                    >
                      <svg className="diagram-edges" aria-label={gt("Answer connections")}>
                        {current.edges.map((edge) => {
                          const a = byId.get(edge.from),
                            b = byId.get(edge.to);
                          if (!a || !b) return null;
                          const end = diagramInputPort(b);
                          return (
                            <g
                              key={edge.id}
                              className="diagram-edge"
                              data-dimmed={flag(
                                Boolean(focus && edge.routineId && edge.routineId !== focus),
                              )}
                              data-selected={flag(selectedEdge === edge.id)}
                              data-state={
                                focus && !diagramEdgeCarries(edge, focus)
                                  ? "dimmed"
                                  : run?.steps.find((step) => step.nodeId === edge.to)?.status ===
                                      "running"
                                    ? "running"
                                    : ["succeeded", "failed"].includes(
                                          run?.steps.find((step) => step.nodeId === edge.to)
                                            ?.status ?? "",
                                        )
                                      ? "delivered"
                                      : "idle"
                              }
                              data-routine-color={
                                edge.routineId
                                  ? diagramRoutineColor(current.nodes, edge.routineId)
                                  : undefined
                              }
                            >
                              <path
                                className="diagram-edge-line"
                                d={diagramEdgePath(diagramOutputPort(a), end)}
                              />
                              <path className="diagram-edge-arrow" d={diagramEdgeArrow(end)} />
                              {!isRoutineStartEdge(edge.id) && (
                                <path
                                  className="diagram-edge-hit"
                                  d={diagramEdgePath(diagramOutputPort(a), end)}
                                  role="button"
                                  data-diagram-edge={edge.id}
                                  tabIndex={0}
                                  aria-label={gt("Connection {value} to {to}", {
                                    value: edge.from,
                                    to: edge.to,
                                  })}
                                  onClick={() => {
                                    setSelectedEdge(edge.id);
                                    setSelected(edge.to);
                                    setPicked(edge.routineId ?? null);
                                    setInspector(true);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setSelectedEdge(edge.id);
                                      setSelected(edge.to);
                                      setPicked(edge.routineId ?? null);
                                      setInspector(true);
                                    }
                                    if ((e.key === "Delete" || e.key === "Backspace") && writable) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      void removeEdge(edge.id);
                                    }
                                  }}
                                />
                              )}
                            </g>
                          );
                        })}
                        {previewSource && pointer && (
                          <path
                            className="diagram-edge-draft"
                            d={diagramEdgePath(diagramOutputPort(previewSource), pointer)}
                          />
                        )}
                      </svg>
                      {current.nodes.map((node) => (
                        <NodeCard
                          key={node.id}
                          node={node}
                          agents={discovery.agents}
                          routines={diagramRoutinesReaching(
                            current.nodes,
                            current.edges,
                            node.id,
                          ).map((routine) => ({
                            id: routine.id,
                            name: routine.name,
                            color: diagramRoutineColor(current.nodes, routine.id),
                          }))}
                          onFocusRoutine={(id) => setPicked(id)}
                          selected={selected === node.id}
                          dimmed={Boolean(focus && node.id !== focus && !steps.has(node.id))}
                          onRun={node.kind === "routine" ? () => startRoutine(node.id) : undefined}
                          focus={focus}
                          step={steps.get(node.id)}
                          run={run}
                          color={
                            node.kind === "routine"
                              ? diagramRoutineColor(current.nodes, node.id)
                              : undefined
                          }
                          writable={writable}
                          connectable={Boolean(focus) && writable}
                          source={source}
                          inputTarget={
                            source
                              ? diagramConnectionProblem(
                                  current.nodes,
                                  focus
                                    ? current.edges.filter((edge) =>
                                        diagramEdgeCarries(edge, focus),
                                      )
                                    : current.edges,
                                  source,
                                  node.id,
                                )
                                ? "invalid"
                                : "valid"
                              : "none"
                          }
                          onSelect={() => {
                            if (!suppressClick.current) select(node);
                          }}
                          onMove={(p) => {
                            moveNode(node.id, p);
                            void savePosition(node.id, p);
                          }}
                          onOutput={() => {
                            setSource(source === node.id ? null : node.id);
                            setMessage("");
                          }}
                          onOutputDragStart={() => {
                            setSource(node.id);
                            setPointer(diagramOutputPort(node));
                          }}
                          onOutputDragMove={(e) => setPointer(world(local(e)))}
                          onOutputDrop={(target) => {
                            if (target) void connect(target);
                            else {
                              setSource(null);
                              setPointer(null);
                            }
                          }}
                          removable={
                            node.kind === "agent" &&
                            node.agentId !== agentId &&
                            !routineOwners.has(node.agentId)
                          }
                          onInput={() => void connect(node.id)}
                          onRemove={() => void removeNode(node)}
                          onEdit={() => {
                            if (node.kind === "routine")
                              onEditRoutine(agentId, routineIdOfNode(node.id)!);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner className="openbot-react">
                    <ContextMenu.Popup className="ui-action-menu" ref={menuMotionRef(undefined)}>
                      {discovery.agents
                        .filter(
                          (a) =>
                            !current.nodes.some((n) => n.kind === "agent" && n.agentId === a.id),
                        )
                        .map((agent) => (
                          <ContextMenu.Item
                            key={agent.id}
                            className="ui-menu-item"
                            disabled={!writable}
                            onClick={() => {
                              const p = menuAt.current.world;
                              void placeAgent(agent.id, p);
                            }}
                          >
                            <SourceAgentAvatar agent={agent} size={20} />
                            <T>Place</T> {agent.name}
                          </ContextMenu.Item>
                        ))}
                      <ContextMenu.Item
                        className="ui-menu-item"
                        disabled={!writable}
                        onClick={() => setNewAgentAt(menuAt.current)}
                      >
                        <Plus />
                        <T>New agent</T>
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className="ui-menu-item"
                        onClick={() => onCreateRoutine(agentId)}
                      >
                        <Plus />
                        <T>Create routine</T>
                      </ContextMenu.Item>
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.Root>
              {routines.length > 1 && (
                <div className="diagram-view-lens-bar" data-diagram-overlay="">
                  <SourceSelect
                    label={gt("Focus routine")}
                    value={focus ?? "all"}
                    options={[
                      { id: "all", name: "All routines" },
                      ...routines.map((n) => ({ id: n.id, name: n.name })),
                    ]}
                    onChange={(id) => setPicked(id === "all" ? null : id)}
                  />
                </div>
              )}
              {selectedEdge && !isRoutineStartEdge(selectedEdge) && (
                <SourceButton
                  className="diagram-board-delete-edge"
                  disabled={!writable}
                  onClick={() => {
                    void removeEdge(selectedEdge);
                    setSelectedEdge(null);
                  }}
                >
                  <T>Disconnect connection</T>
                </SourceButton>
              )}
              <div className="diagram-board-zoom" role="toolbar" aria-label={gt("Canvas zoom")}>
                <SourceButton variant="ghost" aria-label={gt("Zoom in")} onClick={() => zoom(1.2)}>
                  <Plus />
                </SourceButton>
                <SourceButton
                  variant="ghost"
                  aria-label={gt("Zoom out")}
                  onClick={() => zoom(1 / 1.2)}
                >
                  <Minus />
                </SourceButton>
                <SourceButton
                  variant="ghost"
                  aria-label={gt("Fit canvas")}
                  onClick={() => fit(current, true)}
                >
                  <Scan />
                </SourceButton>
              </div>
              {(message || actionError) && (
                <p className="diagram-board-status" role={actionError ? "alert" : "status"}>
                  {actionError ?? message}
                </p>
              )}
            </div>
          )}
          {newAgentAt && (
            <DiagramNewAgentCard
              environmentId={environmentId}
              hostId={hostId}
              at={newAgentAt.screen}
              onCancel={() => setNewAgentAt(null)}
              onCreate={async (id) => {
                discovery.refresh();
                if (!(await placeAgent(id, newAgentAt.world)))
                  throw new Error(
                    "The agent was created, but its placement was not confirmed. Open the existing agent instead of creating another.",
                  );
                setNewAgentAt(null);
              }}
            />
          )}
          {owner && (
            <div className="diagram-view-chat">
              <DiagramChatPanel
                key={`${environmentId}:${hostId}:${owner.id}`}
                environmentId={environmentId}
                hostId={hostId}
                agent={owner}
              />
            </div>
          )}
        </div>
        {inspector && !empty && c.canvas && (
          <DiagramInspector
            environmentId={environmentId}
            hostId={hostId}
            diagram={current}
            canvas={c.canvas}
            agents={discovery.agents}
            selected={selected}
            focus={focus}
            writable={writable}
            onSelect={setSelected}
            onFocus={setPicked}
            onEditTask={(node, routineId, text) => void saveTask(node, routineId, text)}
            onEditRoutine={onEditRoutine}
            onRefresh={c.refresh}
          />
        )}
      </div>
    </main>
  );
}

function NodeCard({
  node,
  agents,
  selected,
  dimmed = false,
  routines = [],
  onFocusRoutine,
  onRun,
  focus,
  step,
  run,
  color,
  writable,
  connectable,
  source,
  inputTarget,
  onSelect,
  onMove,
  onOutput,
  onOutputDragStart,
  onOutputDragMove,
  onOutputDrop,
  removable,
  onInput,
  onRemove,
  onEdit,
}: {
  node: DiagramNode;
  agents: readonly Agent[];
  selected: boolean;
  dimmed?: boolean;
  routines?: readonly { id: string; name: string; color: number | undefined }[];
  onFocusRoutine?: (id: string) => void;
  onRun?: (() => void) | undefined;
  focus: string | null;
  step: number | undefined;
  run: ReturnType<typeof diagramRunOf>;
  color: number | undefined;
  writable: boolean;
  connectable: boolean;
  source: string | null;
  inputTarget: "none" | "valid" | "invalid";
  onSelect: () => void;
  onMove: (p: DiagramPoint) => void;
  onOutput: () => void;
  onOutputDragStart: () => void;
  onOutputDragMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onOutputDrop: (target: string | null) => void;
  removable: boolean;
  onInput: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const gt = useGT();
  const outputDrag = useRef<{ start: DiagramPoint; moved: boolean } | null>(null);
  const draggedOutput = useRef(false);
  const agent = node.kind === "agent" ? agents.find((a) => a.id === node.agentId) : undefined;
  const name = node.kind === "routine" ? node.name : (agent?.name ?? "Unavailable agent");
  const result = run?.steps.find((s) => s.nodeId === node.id);
  const status = result?.status ?? "idle";
  const kicker =
    node.kind === "routine"
      ? !node.active
        ? "Paused"
        : node.upcomingRuns[0]
          ? `Next ${date(node.upcomingRuns[0])}`
          : node.webhook
            ? "Webhook"
            : "Routine"
      : agent?.title || agent?.provider || "Agent";
  return (
    <div
      className="diagram-node"
      data-diagram-node={node.id}
      data-kind={node.kind}
      data-status={status}
      data-selected={flag(selected)}
      data-dimmed={flag(dimmed)}
      data-routine-color={color}
      data-unreachable={flag(node.kind === "agent" && step === undefined)}
      style={
        {
          "--diagram-node-x": `${node.position.x}px`,
          "--diagram-node-y": `${node.position.y}px`,
          "--diagram-node-width": "264px",
        } as CSSProperties
      }
    >
      {node.kind === "agent" && (
        <SourceButton
          variant="ghost"
          className="diagram-port diagram-port-in"
          data-diagram-control=""
          disabled={!connectable}
          data-diagram-input={node.id}
          data-target={inputTarget}
          aria-label={gt("Connect input of {name}", { name })}
          onClick={onInput}
        />
      )}
      <SourceButton
        variant="ghost"
        className="diagram-port diagram-port-out"
        data-diagram-control=""
        data-connecting={flag(source === node.id)}
        disabled={!connectable || node.kind === "routine"}
        aria-label={gt("Connect output of {name}", { name })}
        aria-pressed={source === node.id}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          outputDrag.current = { start: { x: e.clientX, y: e.clientY }, moved: false };
          draggedOutput.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = outputDrag.current;
          if (!drag) return;
          if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) >= 4) {
            drag.moved = true;
            onOutputDragStart();
          }
          if (drag.moved) onOutputDragMove(e);
        }}
        onPointerUp={(e) => {
          const drag = outputDrag.current;
          outputDrag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (drag?.moved) {
            draggedOutput.current = true;
            const target = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest("[data-diagram-input]")
              ?.getAttribute("data-diagram-input");
            onOutputDrop(target ?? null);
          }
        }}
        onPointerCancel={() => {
          if (outputDrag.current?.moved) onOutputDrop(null);
          outputDrag.current = null;
        }}
        onClick={() => {
          if (draggedOutput.current) {
            draggedOutput.current = false;
            return;
          }
          onOutput();
        }}
      />
      <div className="diagram-node-header">
        <SourceButton
          variant="ghost"
          className="diagram-node-select"
          aria-label={gt("Select {name}", { name })}
          aria-pressed={selected}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (!writable) return;
            const d: Record<string, DiagramPoint> = {
              ArrowLeft: { x: -48, y: 0 },
              ArrowRight: { x: 48, y: 0 },
              ArrowUp: { x: 0, y: -48 },
              ArrowDown: { x: 0, y: 48 },
            };
            if (d[e.key]) {
              e.preventDefault();
              onMove(snap({ x: node.position.x + d[e.key]!.x, y: node.position.y + d[e.key]!.y }));
            }
          }}
        >
          {agent ? (
            <span className="diagram-node-avatar">
              <SourceAgentAvatar agent={agent} size={32} />
            </span>
          ) : (
            <span className="diagram-node-icon">
              {node.kind === "routine" && node.webhook ? <Webhook /> : <Clock3 />}
            </span>
          )}
          <span className="diagram-node-heading">
            <span className="diagram-node-kicker">{kicker}</span>
            <strong className="diagram-node-name">{name}</strong>
          </span>
        </SourceButton>
        {selected && removable && (
          <SourceButton
            variant="ghost"
            className="diagram-node-remove"
            data-diagram-control=""
            disabled={!writable}
            aria-label={gt("Remove {name} from canvas", { name })}
            onClick={onRemove}
          >
            <X />
          </SourceButton>
        )}
      </div>
      <div className="diagram-node-body">
        {node.kind === "routine" ? (
          <>
            <p className="diagram-node-schedule">
              {node.schedule
                ? scheduleLabel(node.schedule)
                : node.webhook?.eventType || gt("Any webhook event")}
            </p>
            {node.schedule && <RoutineWeek upcomingRuns={node.upcomingRuns} size="card" />}
            <p className="diagram-node-task">{node.instruction}</p>
            {onRun && (
              <SourceButton
                variant="ghost"
                size="xs"
                className="diagram-node-run"
                data-diagram-control=""
                disabled={!writable}
                onClick={onRun}
              >
                <Play />
                <T>Run now</T>
              </SourceButton>
            )}
            <SourceButton variant="ghost" size="xs" data-diagram-control="" onClick={onEdit}>
              <T>Edit routine</T>
              <ChevronRight />
            </SourceButton>
          </>
        ) : (
          <>
            <p className="diagram-node-task">
              {diagramAgentTask(node, focus) || gt("What this agent does with its input.")}
            </p>
            {routines.length > 0 && (
              <ul className="diagram-node-routines" aria-label={gt("Started by")}>
                {routines.map((routine) => (
                  <li key={routine.id}>
                    <SourceButton
                      variant="ghost"
                      size="xs"
                      className="diagram-routine-chip"
                      data-diagram-control=""
                      data-routine-color={routine.color}
                      aria-pressed={focus === routine.id}
                      title={gt("Show {name}", { name: routine.name })}
                      onClick={() => onFocusRoutine?.(routine.id)}
                    >
                      <span className="diagram-routine-chip-name">{routine.name}</span>
                    </SourceButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="diagram-node-preview" data-empty={flag(!result?.output)}>
              <p>{result?.output || result?.error || gt("Its answer appears here.")}</p>
            </div>
          </>
        )}
      </div>
      <div className="diagram-node-footer">
        <span className="diagram-node-status" data-status={status}>
          {status === "succeeded" ? <Check /> : null}
          {node.kind === "routine"
            ? node.active
              ? gt("Active")
              : gt("Paused")
            : step === undefined
              ? gt("Not connected")
              : gt("Step {step}", { step })}
        </span>
      </div>
    </div>
  );
}

const SAMPLE_AGENTS = [
  {
    id: "research",
    name: "Research",
    provider: "codex",
    title: m(msg("Research partner")),
    avatarSeed: "research",
    position: { x: 400, y: 0 },
    appear: 1,
    task: "Collect the market and product news since yesterday.",
    output: "Three stories worth following.",
  },
  {
    id: "sales",
    name: "Sales",
    provider: "codex",
    title: m(msg("Sales partner")),
    avatarSeed: "sales-outbound",
    position: { x: 400, y: 600 },
    appear: 1,
    task: "Review what changed in the sales pipeline.",
    output: "Two deals moved forward.",
  },
  {
    id: "writer",
    name: "Writer",
    provider: "codex",
    title: m(msg("Writing partner")),
    avatarSeed: "writer",
    position: { x: 840, y: 0 },
    appear: 2,
    task: "Turn the research and pipeline changes into a brief.",
    output: "Your morning brief is ready.",
  },
  {
    id: "chief",
    name: "Chief of staff",
    provider: "codex",
    title: m(msg("Chief of staff")),
    avatarSeed: "chief",
    position: { x: 1200, y: 300 },
    appear: 3,
    task: "Pick today’s priorities from the brief.",
    output: "Here are the three priorities for today.",
  },
];
const SAMPLE_EDGES = [
  { id: "one", from: "sample:routine", to: "research", draw: 1 },
  { id: "two", from: "sample:routine", to: "sales", draw: 1 },
  { id: "three", from: "research", to: "writer", draw: 2 },
  { id: "four", from: "sales", to: "writer", draw: 2 },
  { id: "five", from: "writer", to: "chief", draw: 3 },
];
const SAMPLE_NODES: DiagramNode[] = [
  {
    kind: "routine",
    id: "sample:routine",
    position: { x: 0, y: 300 },
    name: "Morning brief",
    instruction: "Collect what changed since yesterday, then turn it into today’s priorities.",
    schedule: { kind: "weekdays", time: "07:00" },
    active: true,
    upcomingRuns: [],
    recentRuns: [],
  },
  ...SAMPLE_AGENTS.map((a): DiagramNode => ({
    kind: "agent",
    id: a.id,
    agentId: a.id,
    position: a.position,
    task: a.task,
  })),
];
const SAMPLE_BOUNDS = diagramBounds(SAMPLE_NODES);
const SAMPLE_STEPS = diagramRoutineSteps(SAMPLE_EDGES, "sample:routine");
function RoutineEmpty({ onCreate }: { onCreate: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [scale, setScale] = useState(1);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source decorative sample clock runs only while this canvas is visible and motion is allowed.
  useEffect(() => {
    const element = frame.current;
    if (!element || reduced) return;
    let visible = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (visible && !document.hidden) timer = setInterval(() => setTick((n) => n + 1), 1200);
    };
    const observer = new IntersectionObserver((entries) => {
      visible = Boolean(entries[0]?.isIntersecting);
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [reduced]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scale the inert source sample to its measured canvas bounds.
  useLayoutEffect(() => {
    const v = frame.current;
    if (!v) return;
    return observeResize(v, () =>
      setScale(
        Math.max(
          0.2,
          Math.min(
            1,
            (v.clientWidth - 96) / SAMPLE_BOUNDS.width,
            (v.clientHeight - 96) / (SAMPLE_BOUNDS.height + 120),
          ),
        ),
      ),
    );
  }, []);
  const step = reduced ? 9 : tick % 12;
  const run: NonNullable<ReturnType<typeof diagramRunOf>> = {
    id: "decorative-sample",
    routineNodeId: "sample:routine",
    kind: "scheduled",
    status: step >= 9 ? "succeeded" : "running",
    startedAt: "",
    finishedAt: null,
    steps: SAMPLE_AGENTS.filter(() => step >= 4).map((a) => {
      const depth = SAMPLE_STEPS.get(a.id) ?? 0;
      return {
        nodeId: a.id,
        status: step < 4 + depth ? "waiting" : step === 4 + depth ? "running" : "succeeded",
        input: null,
        output: step > 4 + depth ? a.output : null,
        error: null,
        startedAt: null,
        finishedAt: null,
      };
    }),
  };
  const state = (target: string) => run.steps.find((s) => s.nodeId === target)?.status;
  const noop = () => {};
  return (
    <div className="diagram-board diagram-empty" data-still={flag(reduced)}>
      <div className="diagram-board-viewport diagram-empty-viewport">
        <div
          ref={frame}
          className="diagram-empty-backdrop"
          data-leaving={flag(step >= 10)}
          inert
          aria-hidden="true"
        >
          <div className="diagram-empty-grid" />
          <div
            key={Math.floor(tick / 12)}
            className="diagram-board-world diagram-empty-world"
            data-routine-color={step >= 4 ? 0 : undefined}
            style={
              {
                width: `${SAMPLE_BOUNDS.width}px`,
                height: `${SAMPLE_BOUNDS.height}px`,
                "--diagram-empty-scale": String(scale),
              } as CSSProperties
            }
          >
            <svg className="diagram-edges" aria-hidden="true">
              {SAMPLE_EDGES.map((edge) => {
                const a = SAMPLE_NODES.find((n) => n.id === edge.from)!,
                  b = SAMPLE_NODES.find((n) => n.id === edge.to)!;
                return (
                  <g
                    key={edge.id}
                    className="diagram-edge diagram-empty-edge"
                    data-state={
                      state(edge.to) === "running"
                        ? "running"
                        : state(edge.to) === "succeeded"
                          ? "delivered"
                          : "idle"
                    }
                    data-drawn={flag(edge.draw <= step)}
                  >
                    <path
                      className="diagram-edge-line"
                      d={diagramEdgePath(diagramOutputPort(a), diagramInputPort(b))}
                    />
                    <path
                      className="diagram-edge-arrow"
                      d={diagramEdgeArrow(diagramInputPort(b))}
                    />
                  </g>
                );
              })}
            </svg>
            {SAMPLE_NODES.map((node) => (
              <div
                key={node.id}
                className="diagram-empty-node"
                data-shown={flag(
                  (SAMPLE_AGENTS.find((a) => a.id === node.id)?.appear ?? 0) <= step,
                )}
              >
                <NodeCard
                  node={node}
                  agents={SAMPLE_AGENTS}
                  selected={false}
                  focus="sample:routine"
                  step={SAMPLE_STEPS.get(node.id)}
                  run={step >= 4 ? run : null}
                  color={node.kind === "routine" ? 0 : undefined}
                  writable={false}
                  connectable={false}
                  source={null}
                  inputTarget="none"
                  removable={false}
                  onSelect={noop}
                  onMove={noop}
                  onOutput={noop}
                  onInput={noop}
                  onOutputDragStart={noop}
                  onOutputDragMove={noop}
                  onOutputDrop={noop}
                  onRemove={noop}
                  onEdit={noop}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="diagram-empty-pitch">
          <h2 className="diagram-empty-title">
            <span className="diagram-empty-lead">
              <T>Draw it once.</T>
            </span>
            <span>
              <T>Watch it</T> <span className="diagram-empty-hand">run</span>.
            </span>
          </h2>
          <p className="diagram-empty-lines">
            <span>
              <T>A routine starts the work.</T>
            </span>
            <span>
              <T>Each agent hands its answer to the next.</T>
            </span>
          </p>
          <SourceButton className="diagram-empty-action" onClick={onCreate}>
            <T>Create routine</T>
          </SourceButton>
        </div>
      </div>
    </div>
  );
}

function scheduleLabel(schedule: RoutineSchedule) {
  const draft = routineScheduleToDraft(schedule);
  switch (draft.kind) {
    case "once":
      return `${draft.date} at ${clockLabel(draft.time)}`;
    case "daily":
      return `${daysLabel(draft.days)} at ${clockLabel(draft.time)}`;
    case "weekly":
      return `${daysLabel([draft.weekday])} at ${clockLabel(draft.time)}`;
    case "hourly":
      return m(msg("Every {everyHours} hours", { everyHours: draft.everyHours }));
    case "monthly":
      return m(
        msg("Day {day} at {clockLabel}", { day: draft.day, clockLabel: clockLabel(draft.time) }),
      );
    case "yearly":
      return `${draft.month}/${draft.day} at ${clockLabel(draft.time)}`;
    case "custom":
      return draft.expression;
  }
}
