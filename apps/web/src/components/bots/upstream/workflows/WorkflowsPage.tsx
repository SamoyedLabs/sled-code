/* oxlint-disable shadcn/no-unknown-classes -- WorkflowCanvas source selectors come from the scoped workflow styles. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { EnvironmentId, OpenbotWorkflowGraph, OpenbotWorkflowStep } from "@t3tools/contracts";
import {
  workflowDraft,
  workflowEditable,
  workflowExecutable,
  workflowAddNode,
  workflowRemoveNode,
  workflowConnect,
  workflowNodeTitle,
  workflowCanRunNode,
  workflowRunCanStop,
  WORKFLOW_NODE_CHOICES,
} from "@t3tools/client-runtime/openbot/presentation";
import {
  ArrowLeft,
  Copy,
  ClipboardPaste,
  Eraser,
  Highlighter,
  Bot,
  Check,
  ChevronDown,
  Hand,
  History,
  Lock,
  LockOpen,
  Minus,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scan,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Redo2,
  X,
  Zap,
} from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import { menuMotionRef } from "../openbotMenuMotion";
import { useBotWorkflows } from "../../../settings/useBotWorkflows";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { randomUUID } from "../../../../lib/utils";
import { observeResize } from "../../../../lib/observeResize";
import { requestConfirmDialog } from "../../../../confirmDialog";
import { MenuPopup } from "../OpenbotMenu";
import { WorkflowFields } from "./WorkflowFields";
import { useWorkflowCatalogs } from "./useWorkflowCatalogs";
import {
  RESIZE,
  HANDLES,
  resizeNode,
  alignMove,
  erasedAlong,
  collectNodes,
  pasteNodes,
  CLIP_TYPE,
  readCanvasCopy,
  subscribeCanvasCopy,
  storeCanvasCopy,
  type Handle,
  type Guide,
} from "./workflowCanvasModel";
import { INK_WIDTH, INK_STEP, inkPath, overlaps, union, type Box } from "./workflowInk";
import "./workflows.css";
import "./workflow-nodes.css";
import "./workflows-adapter.css";
import { T, Var, useGT } from "gt-react";

type Graph = OpenbotWorkflowGraph;
type Node = Graph["nodes"][number];
type Tool = "select" | "pan" | "draw" | "note" | "shape";
type Point = { x: number; y: number };
const widthOf = (node: Node) =>
  node.size?.width ??
  {
    agent: 350,
    llm: 350,
    trigger: 320,
    output: 320,
    condition: 300,
    approval: 300,
    note: 240,
    shape: 208,
    asset: 240,
    image: 300,
  }[node.kind] ??
  296;
const nodeName = (node: Node) =>
  node.kind === "llm"
    ? "LLM Assistant"
    : node.kind === "agent"
      ? "Agent"
      : node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
function hasTextSelection() {
  const element = document.activeElement;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    return element.selectionStart !== element.selectionEnd;
  return Boolean(window.getSelection()?.toString());
}
export function WorkflowsPage({
  environmentId,
  hostId,
  onBack,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onBack?: () => void;
}) {
  return (
    <WorkflowCanvas
      key={`${environmentId}:${hostId}`}
      environmentId={environmentId}
      hostId={hostId}
      {...(onBack ? { onBack } : {})}
    />
  );
}
function WorkflowCanvas({
  environmentId,
  hostId,
  onBack,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onBack?: () => void;
}) {
  const gt = useGT();
  const c = useBotWorkflows(environmentId, hostId, randomUUID);
  const catalogs = useWorkflowCatalogs(environmentId, hostId, c.canManage);
  const clipboard = useSyncExternalStore(subscribeCanvasCopy, readCanvasCopy);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const nodeId = selection.length === 1 ? (selection[0] ?? null) : null;
  const setNodeId = (id: string | null) => setSelection(id ? [id] : []);
  const [drawMode, setDrawMode] = useState<"pen" | "marker" | "eraser">("pen");
  const [inkColor, setInkColor] = useState("ink");
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<readonly Guide[]>([]);
  const [erasing, setErasing] = useState<readonly string[]>([]);
  const [eraser, setEraser] = useState<Point | null>(null);
  const space = useRef(false);
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const [camera, setCamera] = useState({ x: 100, y: 140, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<"history" | "versions" | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [connection, setConnection] = useState<{
    from: string;
    type: string;
    branch?: "yes" | "no";
  } | null>(null);
  const [undo, setUndo] = useState<Graph[]>([]);
  const [redo, setRedo] = useState<Graph[]>([]);
  const [preview, setPreview] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    kind: "node" | "pan" | "box" | "resize" | "draw" | "erase" | "shape";
    id: string | null;
    start: Point;
    at: Point;
    graph: Graph | null;
    moved: boolean;
    base?: readonly string[];
    group?: readonly Node[];
    box?: Box | undefined;
    others?: readonly Box[];
    handle?: Handle;
    floor?: number;
    erased?: Set<string>;
  } | null>(null);
  const graph = preview ? c.versionGraph : c.graph;
  const [dimensions, setDimensions] = useState<
    Readonly<Record<string, { width: number; height: number }>>
  >({});
  const nodeKeys = JSON.stringify(graph?.nodes.map((node) => node.id) ?? []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source group outlines and alignment use measured card bounds, observed independently from node content renders.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const ids = JSON.parse(nodeKeys) as string[];
    const nodes = ids.flatMap(
      (id) => element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`) ?? [],
    );
    const measure = () => {
      const next = Object.fromEntries(
        nodes.map((node) => [
          node.dataset.nodeId!,
          {
            width: node.offsetWidth,
            height: node.querySelector<HTMLElement>(".wfn-card")?.offsetHeight ?? node.offsetHeight,
          },
        ]),
      );
      setDimensions((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const unobserve = observeResize(
      nodes.flatMap((node) => [node, ...node.querySelectorAll(".wfn-card")]),
      measure,
    );
    measure();
    return unobserve;
  }, [nodeKeys]);
  const editable = !preview && c.canManage && !c.busy && !!graph && workflowEditable(graph);
  const [initialized, setInitialized] = useState(false);
  if (!initialized && c.workflows) {
    setInitialized(true);
    if (c.workflows[0]) c.select(c.workflows[0].id);
  }
  function change(next: Graph, remember = true) {
    if (!editable || !c.detail || !graph) return;
    if (remember) {
      setUndo((previous) => [...previous.slice(-49), graph]);
      setRedo([]);
    }
    c.setDraft({ ...(c.draft ?? workflowDraft(c.detail)), graph: next });
  }
  function selectWorkflow(id: string) {
    c.select(id);
    setNodeId(null);
    setUndo([]);
    setRedo([]);
    setPreview(false);
    setCamera({ x: 100, y: 140, zoom: 1 });
  }
  function add(kind: string, at?: Point) {
    if (!graph || !editable) return;
    const id = randomUUID();
    const next = workflowAddNode(graph, kind, id);
    change({
      ...next,
      nodes: next.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              at: at ?? { x: (240 - camera.x) / camera.zoom, y: (180 - camera.y) / camera.zoom },
            }
          : node,
      ),
    });
    setNodeId(id);
    setTool("select");
  }
  function position(event: { clientX: number; clientY: number }) {
    const bounds = stage.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (bounds?.left ?? 0) - camera.x) / camera.zoom,
      y: (event.clientY - (bounds?.top ?? 0) - camera.y) / camera.zoom,
    };
  }
  const onWheel = useStableCallback((event: WheelEvent) => {
    if (event.target instanceof Element && event.target.closest("textarea,[data-wfn-portal]"))
      return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (stage.current?.clientHeight ?? 700) : 1;
    const dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      const step = Math.max(
        -Math.log(1.2),
        Math.min(Math.log(1.2), -dy * (event.ctrlKey ? 0.007 : 0.002)),
      );
      const zoom = Math.max(0.25, Math.min(2, camera.zoom * Math.exp(step)));
      const point = position(event);
      setCamera({
        x: camera.x + point.x * (camera.zoom - zoom),
        y: camera.y + point.y * (camera.zoom - zoom),
        zoom,
      });
    } else setCamera({ ...camera, x: camera.x - dx * 0.5, y: camera.y - dy * 0.5 });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source canvas needs a non-passive wheel listener to own pinch zoom without zooming the browser.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onWheel]);
  function nodeBox(node: Node): Box {
    return {
      x: node.at.x,
      y: node.at.y,
      width: dimensions[node.id]?.width ?? widthOf(node),
      height: dimensions[node.id]?.height ?? node.size?.height ?? 240,
    };
  }
  function beginResize(event: PointerEvent<HTMLElement>, node: Node, handle: Handle) {
    if (!editable || node.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setNodeId(node.id);
    const element = stage.current?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(node.id)}"]`,
    );
    if (stage.current)
      stage.current.dataset.resizing =
        handle === "n" || handle === "s"
          ? "ns"
          : handle === "w" ||
              handle === "e" ||
              (!RESIZE[node.kind]?.height && node.kind !== "text" && node.kind !== "image")
            ? "ew"
            : handle === "nw" || handle === "se"
              ? "nwse"
              : "nesw";
    const saved = element?.style.getPropertyValue("--wfn-height");
    element?.style.setProperty("--wfn-height", "0px");
    const floor = element?.querySelector<HTMLElement>(".wfn-card")?.offsetHeight ?? 0;
    if (saved) element?.style.setProperty("--wfn-height", saved);
    else element?.style.removeProperty("--wfn-height");
    drag.current = {
      kind: "resize",
      id: node.id,
      start: { x: event.clientX, y: event.clientY },
      at: node.at,
      graph,
      moved: false,
      handle,
      box: nodeBox(node),
      floor,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>, node?: Node) {
    if (
      (event.button !== 0 && event.button !== 1) ||
      (event.target instanceof Element &&
        event.target.closest("button,input,textarea,select,[data-wfn-portal]"))
    )
      return;
    event.preventDefault();
    stage.current?.focus({ preventScroll: true });
    const start = { x: event.clientX, y: event.clientY },
      at = position(event);
    if (tool === "pan" || space.current || event.button === 1) {
      drag.current = { kind: "pan", id: null, start, at: camera, graph: null, moved: false };
    } else if (tool === "draw" && editable && graph) {
      if (drawMode === "eraser") {
        const erased = new Set(erasedAlong(graph, at, at, camera.zoom));
        setErasing([...erased]);
        drag.current = { kind: "erase", id: null, start, at, graph, moved: false, erased };
      } else if (graph.strokes.length < 500) {
        const id = randomUUID();
        drag.current = { kind: "draw", id, start, at, graph, moved: true };
        change(
          {
            ...graph,
            strokes: [
              ...graph.strokes,
              {
                id,
                brush: drawMode,
                color: inkColor,
                width: INK_WIDTH[drawMode] / camera.zoom,
                points: [at],
              },
            ],
          },
          false,
        );
      }
    } else if (tool === "note") {
      add("note", at);
      return;
    } else if (tool === "shape" && editable)
      drag.current = { kind: "shape", id: null, start, at, graph, moved: false };
    else if (node) {
      const next = event.shiftKey
        ? selection.includes(node.id)
          ? selection.filter((id) => id !== node.id)
          : [...selection, node.id]
        : selection.includes(node.id)
          ? selection
          : [node.id];
      setSelection(next);
      if (!editable || node.locked || event.shiftKey) return;
      const group = graph?.nodes.filter((item) => next.includes(item.id) && !item.locked) ?? [];
      drag.current = {
        kind: "node",
        id: node.id,
        start,
        at: node.at,
        graph,
        moved: false,
        group,
        box: union(group.map(nodeBox)),
        others: graph?.nodes.filter((item) => !next.includes(item.id)).map(nodeBox) ?? [],
      };
    } else {
      if (!event.shiftKey) setSelection([]);
      drag.current = {
        kind: "box",
        id: null,
        start,
        at,
        graph,
        moved: false,
        base: event.shiftKey ? selection : [],
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const at = position(event);
    pointer.current = at;
    if (tool === "draw" && drawMode === "eraser") setEraser(at);
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.start.x,
      dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 4 && !["draw", "erase"].includes(current.kind))
      return;
    current.moved = true;
    if (stage.current && current.kind === "node") stage.current.dataset.dragging = "";
    if (stage.current && current.kind === "pan") stage.current.dataset.panning = "";
    if (current.kind === "erase" && current.graph) {
      for (const id of erasedAlong(current.graph, current.at, at, camera.zoom))
        current.erased?.add(id);
      current.at = at;
      setErasing([...(current.erased ?? [])]);
      return;
    }
    if (current.kind === "draw" && graph) {
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
      change(
        {
          ...graph,
          strokes: graph.strokes.map((stroke) => {
            if (stroke.id !== current.id) return stroke;
            const points = [...stroke.points];
            for (const sample of samples.length ? samples : [event]) {
              const point = position(sample),
                last = points.at(-1);
              if (
                points.length < 2000 &&
                (!last || Math.hypot(point.x - last.x, point.y - last.y) * camera.zoom >= INK_STEP)
              )
                points.push(point);
            }
            return { ...stroke, points };
          }),
        },
        false,
      );
      return;
    }
    if (current.kind === "pan") {
      setCamera({ ...camera, x: current.at.x + dx, y: current.at.y + dy });
      return;
    }
    if (current.kind === "box" || current.kind === "shape") {
      const box = {
        x: Math.min(at.x, current.at.x),
        y: Math.min(at.y, current.at.y),
        width: Math.abs(at.x - current.at.x),
        height: Math.abs(at.y - current.at.y),
      };
      setMarquee(box);
      if (current.kind === "box")
        setSelection([
          ...new Set([
            ...(current.base ?? []),
            ...(graph?.nodes
              .filter((node) => overlaps(nodeBox(node), box))
              .map((node) => node.id) ?? []),
          ]),
        ]);
      return;
    }
    if (current.kind === "resize" && graph && current.graph && current.box && current.handle) {
      const node = current.graph.nodes.find((item) => item.id === current.id);
      if (node)
        change(
          {
            ...graph,
            nodes: graph.nodes.map((item) =>
              item.id === node.id
                ? resizeNode(node, current.box!, current.floor ?? 0, current.handle!, {
                    x: dx / camera.zoom,
                    y: dy / camera.zoom,
                  })
                : item,
            ),
          },
          false,
        );
      return;
    }
    if (current.kind === "node" && graph && current.group && current.box) {
      const x = alignMove(
        "x",
        current.at,
        current.box,
        current.others ?? [],
        dx / camera.zoom,
        camera.zoom,
      );
      const y = alignMove(
        "y",
        current.at,
        current.box,
        current.others ?? [],
        dy / camera.zoom,
        camera.zoom,
      );
      setGuides([...x.guides, ...y.guides]);
      change(
        {
          ...graph,
          nodes: graph.nodes.map((node) => {
            const original = current.group?.find((item) => item.id === node.id);
            return original
              ? { ...node, at: { x: original.at.x + x.delta, y: original.at.y + y.delta } }
              : node;
          }),
        },
        false,
      );
    }
  }
  function pointerUp(event?: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    if (stage.current) {
      delete stage.current.dataset.resizing;
      delete stage.current.dataset.dragging;
      delete stage.current.dataset.panning;
    }
    if (!current) return;
    if (event?.type === "pointercancel") {
      if (current.graph && current.moved) change(current.graph, false);
    } else if (current.kind === "erase" && current.graph && current.erased?.size) {
      change({
        ...current.graph,
        strokes: current.graph.strokes.filter((stroke) => !current.erased?.has(stroke.id)),
      });
    } else if (current.kind === "shape" && current.graph) {
      const id = randomUUID(),
        next = workflowAddNode(current.graph, "shape", id);
      change({
        ...next,
        nodes: next.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                at: marquee ? { x: marquee.x, y: marquee.y } : current.at,
                ...(marquee
                  ? {
                      size: {
                        width: Math.max(48, Math.min(960, marquee.width)),
                        height: Math.max(48, Math.min(960, marquee.height)),
                      },
                    }
                  : {}),
              }
            : node,
        ),
      });
      setNodeId(id);
      setTool("select");
    } else if (
      current.moved &&
      current.graph &&
      ["node", "resize", "draw"].includes(current.kind)
    ) {
      setUndo((previous) => [...previous.slice(-49), current.graph!]);
      setRedo([]);
    }
    setMarquee(null);
    setGuides([]);
    setErasing([]);
  }
  function deleteSelection() {
    if (!graph || !editable) return;
    change(selection.reduce((next, id) => workflowRemoveNode(next, id), graph));
    setSelection([]);
  }
  function paste(duplicate = false) {
    if (!graph || !editable) return;
    const clip = duplicate ? collectNodes(graph, selection) : readCanvasCopy()?.clip;
    if (!clip?.nodes.length) return;
    const shift = duplicate
      ? { x: 32, y: 32 }
      : {
          x: pointer.current.x - Math.min(...clip.nodes.map((node) => node.at.x)),
          y: pointer.current.y - Math.min(...clip.nodes.map((node) => node.at.y)),
        };
    const next = pasteNodes(graph, clip, shift, randomUUID);
    if (next) {
      change(next.graph);
      setSelection(next.ids);
    } else c.reportError(gt("This copy would exceed the canvas size limit."));
  }
  function fit() {
    if (!graph?.nodes.length) {
      setCamera({ x: 100, y: 140, zoom: 1 });
      return;
    }
    const minX = Math.min(...graph.nodes.map((node) => node.at.x));
    const minY = Math.min(...graph.nodes.map((node) => node.at.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.at.x + widthOf(node)));
    const maxY = Math.max(...graph.nodes.map((node) => node.at.y + (node.size?.height ?? 250)));
    const bounds = stage.current?.getBoundingClientRect();
    const zoom = Math.min(
      1.5,
      Math.max(
        0.2,
        Math.min(
          ((bounds?.width ?? 1000) - 160) / (maxX - minX),
          ((bounds?.height ?? 700) - 200) / (maxY - minY),
        ),
      ),
    );
    setCamera({ x: 80 - minX * zoom, y: 100 - minY * zoom, zoom });
  }
  function connect(to: string) {
    if (!connection || !graph) return;
    const next = workflowConnect(graph, { id: randomUUID(), ...connection, to });
    if (next) {
      change(next);
      setConnection(null);
    } else
      c.reportError(
        gt("These ports cannot connect. Choose compatible content and a different step."),
      );
  }
  function undoEdit() {
    const previous = undo.at(-1);
    if (!previous || !graph) return;
    setRedo((items) => [...items, graph]);
    setUndo(undo.slice(0, -1));
    change(previous, false);
  }
  function redoEdit() {
    const next = redo.at(-1);
    if (!next || !graph) return;
    setUndo((items) => [...items, graph]);
    setRedo(redo.slice(0, -1));
    change(next, false);
  }
  const currentRun = c.activeRun;
  const stepFor = (id: string) => currentRun?.steps.findLast((step) => step.nodeId === id);
  const tools = [
    { id: "select" as const, label: gt("Select"), Icon: MousePointer2 },
    { id: "pan" as const, label: gt("Pan"), Icon: Hand },
    { id: "draw" as const, label: gt("Draw"), Icon: Pencil },
    { id: "note" as const, label: gt("Sticky note"), Icon: StickyNote },
    { id: "shape" as const, label: gt("Shape"), Icon: Square },
  ];
  return (
    <main
      className="wfn-stage wfn-canvas"
      data-frame="window"
      data-tool={tool}
      aria-label={gt("Workflows")}
      onCopy={(event) => {
        if (!graph || !selection.length || hasTextSelection()) return;
        const key = randomUUID();
        storeCanvasCopy({ key, clip: collectNodes(graph, selection) });
        event.clipboardData.setData(CLIP_TYPE, key);
        event.preventDefault();
      }}
      onCut={(event) => {
        if (!graph || !selection.length || !editable || hasTextSelection()) return;
        const key = randomUUID();
        storeCanvasCopy({ key, clip: collectNodes(graph, selection) });
        event.clipboardData.setData(CLIP_TYPE, key);
        event.preventDefault();
        deleteSelection();
      }}
      onPaste={(event) => {
        if (event.clipboardData.getData(CLIP_TYPE) === readCanvasCopy()?.key) {
          event.preventDefault();
          paste();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " ") space.current = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) space.current = false;
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("input,textarea,select,[contenteditable]")
        )
          return;
        if (event.key === "Escape") {
          setConnection(null);
          setNodeId(null);
          setPanel(null);
          setTool("select");
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redoEdit();
          else undoEdit();
        }
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "a") {
          event.preventDefault();
          setSelection(graph?.nodes.map((node) => node.id) ?? []);
        }
        if (mod && event.key.toLowerCase() === "d") {
          event.preventDefault();
          paste(true);
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          deleteSelection();
        }
        if (!mod && event.key.startsWith("Arrow") && selection.length && graph && editable) {
          event.preventDefault();
          const step = event.shiftKey ? 32 : 8;
          change({
            ...graph,
            nodes: graph.nodes.map((node) =>
              !node.locked && selection.includes(node.id)
                ? {
                    ...node,
                    at: {
                      x:
                        node.at.x +
                        (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
                      y:
                        node.at.y +
                        (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
                    },
                  }
                : node,
            ),
          });
        }
        if (!mod) {
          if (event.key === " ") {
            event.preventDefault();
            space.current = true;
          }
          if (event.key === "v") setTool("select");
          if (event.key === "h") setTool("pan");
          if (event.key === "b") {
            setTool("draw");
            setDrawMode("pen");
          }
          if (event.key === "e") {
            setTool("draw");
            setDrawMode("eraser");
          }
          if (event.key === "n") setTool("note");
          if (event.key === "s") setTool("shape");
        }
      }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger
          ref={stage}
          onContextMenu={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("input,textarea,[contenteditable]")
            ) {
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              return;
            }
            pointer.current = position(event);
            const id =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId
                : undefined;
            if (id && !selection.includes(id)) setSelection([id]);
            if (!id) setSelection([]);
          }}
          className="wfn-viewport"
          tabIndex={0}
          aria-label={gt("Workflow canvas")}
          onPointerLeave={() => setEraser(null)}
          onPointerDown={(event) => pointerDown(event)}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          <svg className="wfn-dots" width="100%" height="100%" aria-hidden="true">
            <defs>
              <pattern
                id="workflow-dots"
                width={24 * camera.zoom}
                height={24 * camera.zoom}
                x={camera.x}
                y={camera.y}
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#workflow-dots)" />
          </svg>
          <div
            className="wfn-world"
            data-group={selection.length > 1 ? "" : undefined}
            style={
              {
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
                "--wfn-scale": camera.zoom,
              } as CSSProperties
            }
          >
            <svg className="wfn-react-connections" aria-label={gt("Workflow connections")}>
              {graph?.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from),
                  to = graph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                const x = from.at.x + widthOf(from),
                  y = from.at.y + 90;
                const endX = to.at.x,
                  endY = to.at.y + 90;
                return (
                  <g key={edge.id}>
                    <path
                      d={`M${x},${y} C${x + 100},${y} ${endX - 100},${endY} ${endX},${endY}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      role="button"
                      tabIndex={0}
                      aria-label={gt("Disconnect {workflowNodeTitle} from {workflowNodeTitle2}", {
                        workflowNodeTitle: workflowNodeTitle(graph, edge.from),
                        workflowNodeTitle2: workflowNodeTitle(graph, edge.to),
                      })}
                      d={`M${x},${y} C${x + 100},${y} ${endX - 100},${endY} ${endX},${endY}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="16"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (editable)
                          change({
                            ...graph,
                            edges: graph.edges.filter((item) => item.id !== edge.id),
                          });
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && editable) {
                          event.preventDefault();
                          change({
                            ...graph,
                            edges: graph.edges.filter((item) => item.id !== edge.id),
                          });
                        }
                      }}
                    />
                    {edge.branch && (
                      <text x={(x + endX) / 2} y={(y + endY) / 2 - 8} fill="currentColor">
                        {edge.branch}
                      </text>
                    )}
                  </g>
                );
              })}
              {graph?.strokes.map((stroke) => (
                <path
                  key={stroke.id}
                  className="wfn-ink-line"
                  d={inkPath(stroke.points)}
                  data-brush={stroke.brush}
                  data-erasing={erasing.includes(stroke.id) ? "" : undefined}
                  style={
                    {
                      "--wfn-ink":
                        stroke.color === "ink"
                          ? "var(--openbot-text-primary)"
                          : `var(--openbot-file-${stroke.color})`,
                    } as CSSProperties
                  }
                  fill="none"
                  stroke={stroke.color === "ink" ? "currentColor" : stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {selection.length > 1 &&
              (() => {
                const box = union(
                  graph?.nodes.filter((node) => selection.includes(node.id)).map(nodeBox) ?? [],
                );
                return box ? (
                  <div
                    className="wfn-group"
                    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                  >
                    <div className="wfn-group-bar">
                      <span className="wfn-group-count">{selection.length} selected</span>
                    </div>
                  </div>
                ) : null;
              })()}
            {guides.map((guide) => (
              <span
                key={`${guide.axis}:${guide.at}:${guide.from}:${guide.to}`}
                className="wfn-guide"
                data-axis={guide.axis}
                style={
                  guide.axis === "x"
                    ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
                    : { top: guide.at, left: guide.from, width: guide.to - guide.from }
                }
              />
            ))}
            {marquee && (
              <span
                className="wfn-marquee"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            )}
            {tool === "draw" && drawMode === "eraser" && eraser && (
              <span
                className="wfn-eraser"
                aria-hidden="true"
                style={{ left: eraser.x, top: eraser.y, scale: 1 / camera.zoom }}
              />
            )}
            {graph?.nodes.map((node) => (
              <div
                key={node.id}
                className="wfn-slot"
                style={{ transform: `translate(${node.at.x}px, ${node.at.y}px)` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  pointerDown(event, node);
                }}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              >
                <article
                  className={node.kind === "text" ? "wfn-node wfn-text" : "wfn-node"}
                  data-kind={node.kind}
                  data-node-id={node.id}
                  data-height={node.size?.height ? "" : undefined}
                  data-selected={selection.includes(node.id) ? "" : undefined}
                  style={
                    {
                      "--wfn-width": `${widthOf(node)}px`,
                      "--wfn-note": `var(--openbot-file-${String(node.fields.tone ?? "yellow")})`,
                      "--wfn-note-ink":
                        node.fields.ink && node.fields.ink !== "ink"
                          ? `var(--openbot-file-${String(node.fields.ink)})`
                          : "#2b2924",
                      "--wfn-shape":
                        node.fields.color && node.fields.color !== "ink"
                          ? `var(--openbot-file-${String(node.fields.color)})`
                          : "var(--openbot-text-primary)",
                      ...(node.size?.height ? { "--wfn-height": `${node.size.height}px` } : {}),
                      ...(node.size?.font ? { "--wfn-text-font": `${node.size.font}px` } : {}),
                    } as CSSProperties
                  }
                >
                  <div className="wfn-label">
                    {node.kind === "agent" ? (
                      <Bot size={13} />
                    ) : node.kind === "trigger" ? (
                      <Zap size={13} />
                    ) : (
                      <Type size={13} />
                    )}
                    <span>{nodeName(node)}</span>
                    {node.locked && <Lock size={12} />}
                  </div>
                  <div
                    className="wfn-card"
                    onFocus={() => {
                      if (!selection.includes(node.id)) setNodeId(node.id);
                    }}
                  >
                    {nodeId === node.id && (
                      <div className="wfn-react-node-actions">
                        <button
                          className="wfn-tool-action"
                          aria-label={node.locked ? gt("Unlock step") : gt("Lock step")}
                          disabled={!editable}
                          onClick={() =>
                            change({
                              ...graph,
                              nodes: graph.nodes.map((item) =>
                                item.id === node.id ? { ...item, locked: !item.locked } : item,
                              ),
                            })
                          }
                        >
                          {node.locked ? <LockOpen size={13} /> : <Lock size={13} />}
                        </button>
                        <button
                          className="wfn-tool-action"
                          aria-label={gt("Delete step")}
                          disabled={!editable || node.locked}
                          onClick={() => {
                            change(workflowRemoveNode(graph, node.id));
                            setNodeId(null);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                    <WorkflowFields
                      node={node}
                      graph={graph}
                      agents={c.agents}
                      catalogs={catalogs}
                      environmentId={environmentId}
                      hostId={hostId}
                      workflowId={c.selected ?? ""}
                      saved={c.detail?.triggers.find((trigger) => trigger.nodeId === node.id)}
                      disabled={!editable || Boolean(node.locked)}
                      canRun={c.canRun && !c.busy && !c.draft && !preview}
                      onRunAccepted={c.refresh}
                      savedGraph={!c.draft}
                      onFields={(fields) =>
                        change({
                          ...graph,
                          nodes: graph.nodes.map((item) =>
                            item.id === node.id
                              ? {
                                  ...item,
                                  fields: { ...item.fields, ...fields },
                                  ...(fields.trigger === "schedule" && !item.schedule
                                    ? { schedule: { kind: "daily", time: "09:00" } }
                                    : {}),
                                }
                              : item,
                          ),
                        })
                      }
                      onSchedule={(schedule) =>
                        change({
                          ...graph,
                          nodes: graph.nodes.map((item) =>
                            item.id === node.id ? { ...item, schedule } : item,
                          ),
                        })
                      }
                    />
                    {(workflowCanRunNode(node) || node.kind === "trigger") &&
                      !(node.kind === "trigger" && node.fields.trigger === "github") && (
                        <button
                          className="wfn-react-step-run"
                          disabled={c.busy || !c.canRun || Boolean(c.draft) || preview}
                          onClick={() =>
                            node.kind === "trigger"
                              ? c.startFrom(node.id)
                              : c.start("workflow.runStep", node.id)
                          }
                        >
                          <Play size={12} />
                          {node.kind === "trigger"
                            ? node.fields.trigger === "manual"
                              ? gt("Run workflow")
                              : gt("Run now")
                            : gt("Run step")}
                        </button>
                      )}
                    {stepFor(node.id) && (
                      <StepResult
                        step={stepFor(node.id)!}
                        canRun={c.canRun && !c.busy}
                        onRetry={(id) => c.start("workflow.retryStep", id)}
                        onStop={(id) => void c.act({ operation: "workflow.stopStep", stepId: id })}
                        onDecision={(id, approved) =>
                          void c.act({ operation: "workflow.decide", stepId: id, approved })
                        }
                      />
                    )}
                    {!["trigger", "prompt", "asset", "text", "note", "shape"].includes(
                      node.kind,
                    ) && (
                      <span className="wfn-ports" data-side="in">
                        {[
                          "text",
                          ...(["agent", "llm", "output"].includes(node.kind)
                            ? ["image", "file"]
                            : []),
                        ].map((type) => (
                          <span key={type} className="wfn-port-slot" data-side="in">
                            <button
                              className="wfn-port"
                              aria-label={gt("Connect {type} to {nodeName}", {
                                type,
                                nodeName: nodeName(node),
                              })}
                              disabled={!editable || !connection || connection.type !== type}
                              data-target={connection?.type === type ? "" : undefined}
                              onClick={() => connect(node.id)}
                            >
                              <Plus size={12} />
                            </button>
                          </span>
                        ))}
                      </span>
                    )}
                    {!["output", "text", "note", "shape"].includes(node.kind) && (
                      <span className="wfn-ports" data-side="out">
                        {(node.kind === "condition"
                          ? ["yes", "no"]
                          : [node.kind === "image" ? "image" : "text"]
                        ).map((port) => (
                          <span key={port} className="wfn-port-slot" data-side="out">
                            <button
                              className="wfn-port"
                              aria-label={gt("Connect {port} from {nodeName}", {
                                port,
                                nodeName: nodeName(node),
                              })}
                              disabled={!editable}
                              data-armed={connection?.from === node.id ? "" : undefined}
                              onClick={() =>
                                setConnection(
                                  connection?.from === node.id
                                    ? null
                                    : {
                                        from: node.id,
                                        type: node.kind === "image" ? "image" : "text",
                                        ...(port === "yes" || port === "no"
                                          ? { branch: port }
                                          : {}),
                                      },
                                )
                              }
                            >
                              <Plus size={12} />
                            </button>
                            {node.kind === "condition" && (
                              <span className="wfn-port-chip">{port}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {editable &&
                    !node.locked &&
                    selection.includes(node.id) &&
                    HANDLES.filter(
                      (handle) =>
                        RESIZE[node.kind]?.height ||
                        node.kind === "image" ||
                        !["n", "s"].includes(handle),
                    ).map((handle) => (
                      <button
                        key={handle}
                        className="wfn-grip"
                        data-corner={handle}
                        data-side={handle.length === 1 ? "" : undefined}
                        data-wfn-resize={node.id}
                        aria-label={gt("Resize {nodeName} {handle}", {
                          nodeName: nodeName(node),
                          handle,
                        })}
                        onPointerDown={(event) => beginResize(event, node, handle)}
                        onDoubleClick={() =>
                          change({
                            ...graph,
                            nodes: graph.nodes.map((item) => {
                              if (item.id !== node.id) return item;
                              const { size: _size, ...rest } = item;
                              return rest;
                            }),
                          })
                        }
                      />
                    ))}
                </article>
              </div>
            ))}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="openbot-react">
            <ContextMenu.Popup
              className="ui-action-menu wfn-menu"
              ref={menuMotionRef(undefined)}
              aria-label={gt("Canvas actions")}
            >
              <ContextMenu.Item
                disabled={!selection.length}
                onClick={() => {
                  if (graph)
                    storeCanvasCopy({ key: randomUUID(), clip: collectNodes(graph, selection) });
                  document.execCommand("copy");
                }}
              >
                <T>Copy</T>
              </ContextMenu.Item>
              <ContextMenu.Item
                disabled={!editable || !selection.length}
                onClick={() => {
                  if (graph)
                    storeCanvasCopy({ key: randomUUID(), clip: collectNodes(graph, selection) });
                  document.execCommand("copy");
                  deleteSelection();
                }}
              >
                <T>Cut</T>
              </ContextMenu.Item>
              <ContextMenu.Item disabled={!editable || !clipboard} onClick={() => paste()}>
                <T>Paste</T>
              </ContextMenu.Item>
              <ContextMenu.Item
                disabled={!editable || !selection.length}
                onClick={() => paste(true)}
              >
                <T>Duplicate</T>
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                disabled={!graph?.nodes.length}
                onClick={() => setSelection(graph?.nodes.map((node) => node.id) ?? [])}
              >
                <T>Select all</T>
              </ContextMenu.Item>
              <ContextMenu.Item
                disabled={!editable || !selection.length}
                onClick={() => {
                  if (graph) {
                    const lock = !graph.nodes
                      .filter((node) => selection.includes(node.id))
                      .every((node) => node.locked);
                    change({
                      ...graph,
                      nodes: graph.nodes.map((node) =>
                        selection.includes(node.id) ? { ...node, locked: lock } : node,
                      ),
                    });
                  }
                }}
              >
                <T>Lock / unlock selection</T>
              </ContextMenu.Item>
              <ContextMenu.Item
                disabled={!editable || !selection.length}
                onClick={() => {
                  if (graph)
                    change({
                      ...graph,
                      nodes: graph.nodes.map((node) => {
                        if (!selection.includes(node.id) || node.locked) return node;
                        const { size: _size, ...rest } = node;
                        return rest;
                      }),
                    });
                }}
              >
                <T>Reset size</T>
              </ContextMenu.Item>
              <ContextMenu.Item onClick={fit}>
                <T>Fit workflow</T>
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={!editable || !selection.length} onClick={deleteSelection}>
                Delete
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <div className="wfn-hud-top">
        <div className="wfn-hud wfn-hud-title">
          {onBack && (
            <button className="wfn-hud-tool" aria-label={gt("Back")} onClick={onBack}>
              <ArrowLeft size={16} />
            </button>
          )}
          <Menu.Root>
            <Menu.Trigger className="wfn-hud-switcher">
              <span className="wfn-hud-switcher-name">
                {c.detail?.summary.title ?? gt("Workflows")}
              </span>
              <ChevronDown size={13} />
            </Menu.Trigger>
            <MenuPopup align="start">
              <input
                aria-label={gt("Search workflows")}
                placeholder={gt("Search workflows…")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {c.workflows
                ?.filter((workflow) => workflow.title.toLowerCase().includes(search.toLowerCase()))
                .map((workflow) => (
                  <Menu.Item
                    key={workflow.id}
                    disabled={Boolean(c.draft) || c.busy}
                    onClick={() => selectWorkflow(workflow.id)}
                  >
                    {workflow.title}
                    {workflow.id === c.selected && <Check size={12} />}
                  </Menu.Item>
                ))}
              <Menu.Separator />
              <Menu.Item
                disabled={!c.canManage || c.busy || Boolean(c.draft)}
                onClick={() =>
                  void c.act({ operation: "workflow.create", title: gt("Untitled workflow") })
                }
              >
                <Plus size={14} />
                <T>New workflow</T>
              </Menu.Item>
              <Menu.Item
                disabled={!c.detail || !editable || Boolean(c.draft)}
                onClick={() => setRename(c.detail?.summary.title ?? "")}
              >
                <T>Rename</T>
              </Menu.Item>
              <Menu.Item onClick={() => setPanel(panel === "versions" ? null : "versions")}>
                <T>Version history</T>
              </Menu.Item>
              <Menu.Item
                disabled={!c.detail || !editable || Boolean(c.draft)}
                onClick={() => {
                  const id = c.selected;
                  if (id)
                    void requestConfirmDialog(
                      `Delete ${c.detail?.summary.title} and its workflow history?`,
                      { variant: "destructive" },
                    )?.then((confirmed) => {
                      if (confirmed) void c.act({ operation: "workflow.delete", workflowId: id });
                    });
                }}
              >
                <Trash2 size={14} />
                <T>Delete workflow</T>
              </Menu.Item>
            </MenuPopup>
          </Menu.Root>
          {rename !== null && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (c.selected && rename.trim())
                  void c.act({
                    operation: "workflow.rename",
                    workflowId: c.selected,
                    title: rename.trim(),
                  });
                setRename(null);
              }}
            >
              <input
                aria-label={gt("Workflow name")}
                value={rename}
                maxLength={160}
                onChange={(event) => setRename(event.target.value)}
              />
              <button type="submit">
                <T>Save</T>
              </button>
              <button
                type="button"
                aria-label={gt("Cancel rename")}
                onClick={() => setRename(null)}
              >
                <X size={12} />
              </button>
            </form>
          )}
        </div>
        <div className="wfn-hud-group">
          <div className="wfn-hud">
            {currentRun && (
              <span className="wfn-react-run-status">
                <T>
                  Run <Var>{currentRun.run.number}</Var> · <Var>{currentRun.run.status}</Var>
                </T>
              </span>
            )}
            <button
              className="wfn-hud-tool"
              aria-label={gt("Run history")}
              aria-pressed={panel === "history"}
              onClick={() => setPanel(panel === "history" ? null : "history")}
            >
              <History size={16} />
            </button>
            {currentRun && workflowRunCanStop(currentRun.run.status) ? (
              <button
                className="wfn-hud-tool"
                disabled={!c.canRun || c.busy}
                onClick={() =>
                  void c.act({ operation: "workflow.stopRun", runId: currentRun.run.id })
                }
              >
                <Square size={13} />
                <T>Stop</T>
              </button>
            ) : (
              <button
                className="wfn-hud-tool"
                disabled={
                  !graph ||
                  !workflowExecutable(graph) ||
                  !c.canRun ||
                  c.busy ||
                  Boolean(c.draft) ||
                  preview
                }
                onClick={() => c.start("workflow.startRun")}
              >
                <Play size={13} />
                <T>Run</T>
              </button>
            )}
          </div>
        </div>
      </div>
      {(c.error || c.notice || c.draft || preview) && (
        <div className="wfn-react-notice" role={c.error ? "alert" : "status"}>
          {c.error ?? c.notice}
          {c.draft && (
            <>
              <span>
                {c.draft.conflict
                  ? gt("A newer version exists. Your draft is retained.")
                  : gt("Unsaved changes")}
              </span>
              <button disabled={!editable || Boolean(c.draft.conflict)} onClick={c.save}>
                <T>Save</T>
              </button>
              <button
                disabled={c.busy}
                onClick={() => {
                  c.setDraft(null);
                  setUndo([]);
                  setRedo([]);
                }}
              >
                <T>Discard</T>
              </button>
              {c.draft.conflict && (
                <button
                  onClick={() => {
                    const conflict = c.draft?.conflict;
                    if (conflict) c.setDraft(workflowDraft(conflict));
                  }}
                >
                  <T>Use server version</T>
                </button>
              )}
            </>
          )}
          {preview && (
            <button onClick={() => setPreview(false)}>
              <T>Close version preview</T>
            </button>
          )}
        </div>
      )}
      {!graph && (
        <div className="wfn-react-empty">
          <h2>
            {preview
              ? gt("Loading version…")
              : c.loading
                ? gt("Loading workflows…")
                : gt("Connect your work.")}
          </h2>
          {!c.loading && !preview && (
            <>
              <p>
                <T>Add a prompt, an agent, or a decision to build a workflow.</T>
              </p>
              <button
                disabled={!c.canManage || c.busy}
                onClick={() =>
                  void c.act({ operation: "workflow.create", title: gt("Untitled workflow") })
                }
              >
                <T>Create workflow</T>
              </button>
              <button onClick={c.refresh}>
                <T>Retry</T>
              </button>
            </>
          )}
        </div>
      )}
      {graph?.nodes.length === 0 && (
        <div className="wfn-react-empty">
          <h2>
            <T>Start with a step</T>
          </h2>
          <p>
            <T>Add a prompt, then connect it to an agent.</T>
          </p>
          <button disabled={!editable} onClick={() => add("prompt")}>
            <Plus size={14} />
            <T>Add prompt</T>
          </button>
        </div>
      )}
      <div className="wfn-hud wfn-hud-tools">
        {tools.map(({ id, label, Icon }) => (
          <button
            key={id}
            className="wfn-hud-tool"
            aria-label={label}
            aria-pressed={tool === id}
            disabled={!["select", "pan"].includes(id) && !editable}
            onClick={() => setTool(id)}
          >
            <Icon size={17} />
          </button>
        ))}
        {tool === "draw" && (
          <>
            <button
              className="wfn-hud-tool"
              aria-label={gt("Pen")}
              aria-pressed={drawMode === "pen"}
              onClick={() => setDrawMode("pen")}
            >
              <Pencil size={16} />
            </button>
            <button
              className="wfn-hud-tool"
              aria-label={gt("Marker")}
              aria-pressed={drawMode === "marker"}
              onClick={() => setDrawMode("marker")}
            >
              <Highlighter size={16} />
            </button>
            <button
              className="wfn-hud-tool"
              aria-label={gt("Eraser")}
              aria-pressed={drawMode === "eraser"}
              onClick={() => setDrawMode("eraser")}
            >
              <Eraser size={16} />
            </button>
            {["ink", "yellow", "orange", "red", "pink", "blue", "teal", "green"].map((color) => (
              <button
                key={color}
                className="wfn-hud-tool wfn-ink-swatch"
                aria-label={gt("Ink {color}", { color })}
                aria-pressed={inkColor === color}
                onClick={() => {
                  setInkColor(color);
                  if (drawMode === "eraser") setDrawMode("pen");
                }}
              >
                <span
                  className="wfn-ink-dot"
                  style={
                    {
                      "--wfn-ink":
                        color === "ink"
                          ? "var(--openbot-text-primary)"
                          : `var(--openbot-file-${color})`,
                    } as CSSProperties
                  }
                />
              </button>
            ))}
          </>
        )}
        {selection.length > 0 && (
          <button
            className="wfn-hud-tool"
            aria-label={gt("Duplicate selection")}
            disabled={!editable}
            onClick={() => paste(true)}
          >
            <Copy size={16} />
          </button>
        )}
        <button
          className="wfn-hud-tool"
          aria-label={gt("Paste copied nodes")}
          disabled={!editable || !clipboard}
          onClick={() => paste()}
        >
          <ClipboardPaste size={16} />
        </button>
        <Menu.Root>
          <Menu.Trigger className="wfn-hud-tool wfn-hud-add-button" disabled={!editable}>
            <Plus size={16} />
            <T>Add step</T>
          </Menu.Trigger>
          <MenuPopup>
            {WORKFLOW_NODE_CHOICES.filter((kind) => kind !== "image" && kind !== "asset").map(
              (kind) => (
                <Menu.Item key={kind} onClick={() => add(kind)}>
                  {kind === "llm"
                    ? gt("LLM Assistant")
                    : kind.charAt(0).toUpperCase() + kind.slice(1)}
                </Menu.Item>
              ),
            )}
          </MenuPopup>
        </Menu.Root>
      </div>
      <div className="wfn-hud wfn-hud-zoom">
        <button
          className="wfn-hud-tool"
          aria-label={gt("Zoom out")}
          onClick={() => setCamera({ ...camera, zoom: Math.max(0.25, camera.zoom / 1.2) })}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button
          className="wfn-hud-tool"
          aria-label={gt("Zoom in")}
          onClick={() => setCamera({ ...camera, zoom: Math.min(2, camera.zoom * 1.2) })}
        >
          <Plus size={16} />
        </button>
        <button className="wfn-hud-tool" aria-label={gt("Fit workflow")} onClick={fit}>
          <Scan size={16} />
        </button>
        <button
          className="wfn-hud-tool"
          aria-label={gt("Undo")}
          disabled={!editable || !undo.length}
          onClick={undoEdit}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="wfn-hud-tool"
          aria-label={gt("Redo")}
          disabled={!editable || !redo.length}
          onClick={redoEdit}
        >
          <Redo2 size={15} />
        </button>
      </div>
      {connection && (
        <div className="wfn-react-connect" role="status">
          <T>Choose a matching input to connect.</T>{" "}
          <button onClick={() => setConnection(null)}>
            <T>Cancel</T>
          </button>
        </div>
      )}
      {panel && (
        <aside
          className="wfn-react-history"
          aria-label={panel === "history" ? gt("Run history") : gt("Version history")}
        >
          <header>
            <h2>{panel === "history" ? gt("Run history") : gt("Version history")}</h2>
            <button aria-label={gt("Close history")} onClick={() => setPanel(null)}>
              <X size={16} />
            </button>
          </header>
          {panel === "history" ? (
            <>
              <ul>
                {c.runs?.runs.map((run) => (
                  <li key={run.run.id}>
                    <button
                      aria-pressed={currentRun?.run.id === run.run.id}
                      onClick={() => c.inspectRun(run.run.id)}
                    >
                      <span>
                        <T>
                          Run <Var>{run.run.number}</Var>
                        </T>
                      </span>
                      <span>{run.run.status}</span>
                      <time>{new Date(run.run.startedAt).toLocaleString()}</time>
                    </button>
                  </li>
                ))}
              </ul>
              {c.runs?.runs.length === 0 && (
                <p>
                  <T>No runs yet.</T>
                </p>
              )}
              <button onClick={c.newest}>
                <T>Newest</T>
              </button>
              <button disabled={!c.runs?.nextBefore} onClick={c.older}>
                <T>Older</T>
              </button>
              {currentRun?.run.error && <p role="alert">{currentRun.run.error}</p>}
              {c.runs?.soloSteps.map((step) => (
                <StepResult
                  key={step.id}
                  step={step}
                  canRun={c.canRun && !c.busy}
                  onRetry={(id) => c.start("workflow.retryStep", id)}
                  onStop={(id) => void c.act({ operation: "workflow.stopStep", stepId: id })}
                  onDecision={(id, approved) =>
                    void c.act({ operation: "workflow.decide", stepId: id, approved })
                  }
                />
              ))}
            </>
          ) : (
            <ul>
              {c.versions?.map((version) => (
                <li key={version.id}>
                  <button
                    onClick={() => {
                      c.inspectVersion(version.id);
                      setPreview(true);
                    }}
                  >
                    <T>Revision</T> {version.revision} · {version.kind}
                    <time>{new Date(version.at).toLocaleString()}</time>
                  </button>
                  <button
                    disabled={!c.canManage || c.busy || Boolean(c.draft)}
                    onClick={() => {
                      if (c.selected)
                        void c.act({
                          operation: "workflow.restoreVersion",
                          workflowId: c.selected,
                          versionId: version.id,
                        });
                      setPreview(false);
                    }}
                  >
                    <RotateCcw size={12} />
                    <T>Restore</T>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </main>
  );
}
function StepResult({
  step,
  canRun,
  onRetry,
  onStop,
  onDecision,
}: {
  step: OpenbotWorkflowStep;
  canRun: boolean;
  onRetry: (id: string) => void;
  onStop: (id: string) => void;
  onDecision: (id: string, approved: boolean) => void;
}) {
  return (
    <div className="wfn-field wfn-field-result">
      <div className="wfn-field-head">
        <span>
          <T>
            <Var>{step.status}</Var> · attempt <Var>{step.attempt}</Var>
          </T>
        </span>
      </div>
      {step.output && <p>{step.output}</p>}
      {step.error && (
        <p data-failed="" role="alert">
          {step.error}
        </p>
      )}
      {step.status === "approval" && (
        <div>
          <button disabled={!canRun} onClick={() => onDecision(step.id, true)}>
            <T>Approve</T>
          </button>
          <button disabled={!canRun} onClick={() => onDecision(step.id, false)}>
            <T>Decline</T>
          </button>
        </div>
      )}
      {workflowRunCanStop(step.status) && (
        <button disabled={!canRun} onClick={() => onStop(step.id)}>
          <T>Stop step</T>
        </button>
      )}
      {["failed", "stopped"].includes(step.status) && (
        <button disabled={!canRun} onClick={() => onRetry(step.id)}>
          <T>Retry step</T>
        </button>
      )}
    </div>
  );
}
