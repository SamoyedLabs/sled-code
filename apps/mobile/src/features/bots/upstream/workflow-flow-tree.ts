import type { OpenbotWorkflowGraph as WorkflowGraph } from "@t3tools/contracts";

type WorkflowBranch = "yes" | "no";
type WorkflowNode = WorkflowGraph["nodes"][number];
type WorkflowEdge = WorkflowGraph["edges"][number];
export type GraphPlace =
  | { kind: "edge"; edgeId: string }
  | { kind: "after"; nodeId: string; branch?: WorkflowBranch };

const annotates = new Set(["text", "note", "shape"]);
const isWorkflowStepKind = (kind: string) => !annotates.has(kind);

export function workflowLoopEdges(
  nodes: readonly { id: string }[],
  edges: readonly { id: string; from: string; to: string }[],
): Set<string> {
  const next = new Map<string, { id: string; to: string }[]>();
  const entered = new Set<string>();
  for (const edge of edges) {
    const list = next.get(edge.from);
    if (list) list.push(edge);
    else next.set(edge.from, [edge]);
    entered.add(edge.to);
  }
  const loops = new Set<string>();
  const done = new Set<string>();
  const open = new Set<string>();
  const starts = [
    ...nodes.filter((node) => !entered.has(node.id)),
    ...nodes.filter((node) => entered.has(node.id)),
  ];
  // Without recursion: a long chain must not reach the stack limit.
  for (const { id: start } of starts) {
    if (done.has(start)) continue;
    const stack = [{ id: start, index: 0 }];
    open.add(start);
    for (let top = stack.at(-1); top; top = stack.at(-1)) {
      const edge = next.get(top.id)?.[top.index];
      if (!edge) {
        stack.pop();
        open.delete(top.id);
        done.add(top.id);
        continue;
      }
      top.index += 1;
      if (open.has(edge.to)) loops.add(edge.id);
      else if (!done.has(edge.to)) {
        open.add(edge.to);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return loops;
}

/**
 * The phone draws branches up to their shared join and represents loops or shared steps as jumps.
 * Edit points cover connections and path ends. Inputs and outputs sit beside their owning step.
 */
export type FlowItem =
  | { type: "step"; id: string }
  /** `joined`: the paths meet again and the flow goes on after them; else each path ends by itself. */
  | { type: "split"; from: string; paths: FlowPath[]; joined: boolean }
  /** `from`: the step that the way leaves, so two ways to one step have their own keys. */
  | { type: "jump"; from: string; to: string; loop: boolean }
  | { type: "add"; place: GraphPlace };

export interface FlowPath {
  /** Stable among the paths of one split: the branch, or the first step of the path. */
  key: string;
  /** The branch of a condition, or null for a step that sends its result to more than one step. */
  branch: WorkflowBranch | null;
  items: FlowItem[];
  /** The path goes on to a step after the split, its join or a join further out; else the run ends. */
  goesOn: boolean;
}

export interface FlowTree {
  items: FlowItem[];
  /** The steps that no trigger reaches. */
  loose: string[];
}

const BRANCH_ORDER: Record<WorkflowBranch, number> = { yes: 0, no: 1 };

export function workflowFlowTree(graph: WorkflowGraph): FlowTree {
  const steps = graph.nodes.filter((node) => isWorkflowStepKind(node.kind));
  const byId = new Map(steps.map((node) => [node.id, node]));
  const edges = graph.edges.filter(
    (edge) => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to,
  );
  const loops = workflowLoopEdges(steps, edges);
  const out = new Map<string, WorkflowEdge[]>();
  const into = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (loops.has(edge.id)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge]);
  }
  const loopEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of edges)
    if (loops.has(edge.id)) loopEdges.set(edge.from, [...(loopEdges.get(edge.from) ?? []), edge]);

  const position = (id: string) => byId.get(id)?.at ?? { x: 0, y: 0 };
  // The canvas reads from left to right, then from top to bottom.
  const byPosition = (left: string, right: string) =>
    position(left).x - position(right).x || position(left).y - position(right).y;
  const isLeaf = (id: string) => (out.get(id) ?? []).length === 0 && !loopEdges.has(id);
  /** A step with no way in that feeds the steps after it, such as a prompt. */
  // Only a prompt or a file feeds the step after it. Any other step with no way in does not run: it
  // stays with the steps that no trigger reaches.
  const isFeeder = (node: WorkflowNode) =>
    (node.kind === "prompt" || node.kind === "asset") && (into.get(node.id) ?? []).length === 0;

  const placed = new Set<string>();
  /** Whether the last walk stopped at a join: its path goes on after the split. */
  let endedAtStop = false;

  /**
   * The steps that a step reaches, with the fewest edges to each. It does not go past a step of `stop`,
   * the join of an outer split: the paths of an inner split must join before the outer paths do.
   */
  const reach = (start: string, stop: ReadonlySet<string>) => {
    const distance = new Map([[start, 0]]);
    let layer = [start];
    while (layer.length > 0) {
      const next: string[] = [];
      for (const id of layer) {
        if (stop.has(id)) continue;
        for (const edge of out.get(id) ?? [])
          if (!distance.has(edge.to) && !placed.has(edge.to)) {
            distance.set(edge.to, (distance.get(id) ?? 0) + 1);
            next.push(edge.to);
          }
      }
      layer = next;
    }
    return distance;
  };

  /** The nearest step that every path reaches: the paths join there. */
  const joinOf = (targets: readonly string[], stop: ReadonlySet<string>): string | undefined => {
    const maps = targets.map((target) => reach(target, stop));
    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [id] of maps[0] ?? []) {
      if (!maps.every((map) => map.has(id))) continue;
      const distance = Math.max(...maps.map((map) => map.get(id) ?? 0));
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  };

  const place = (id: string, items: FlowItem[]) => {
    // A prompt or a file that feeds this step comes first, as it does in the editor.
    for (const edge of into.get(id) ?? []) {
      const feeder = byId.get(edge.from);
      if (feeder && isFeeder(feeder) && !placed.has(feeder.id)) {
        placed.add(feeder.id);
        items.push({ type: "step", id: feeder.id });
      }
    }
    placed.add(id);
    items.push({ type: "step", id });
  };

  /** `via`: the connection into `start`, which is a place to add a step. */
  const walk = (
    start: string | undefined,
    stop: ReadonlySet<string>,
    via?: WorkflowEdge,
  ): FlowItem[] => {
    const items: FlowItem[] = [];
    if (via) items.push({ type: "add", place: { kind: "edge", edgeId: via.id } });
    let current = start;
    let previous = via?.from ?? "";
    while (current && !stop.has(current)) {
      if (placed.has(current)) {
        items.push({ type: "jump", from: previous, to: current, loop: false });
        break;
      }
      place(current, items);
      const from = current;
      const ways = out.get(from) ?? [];
      // An output with no way on takes the result of this step; the flow goes on from this step.
      const ends = ways.filter(
        (edge) =>
          !edge.branch &&
          byId.get(edge.to)?.kind === "output" &&
          isLeaf(edge.to) &&
          (into.get(edge.to) ?? []).length === 1 &&
          !stop.has(edge.to) &&
          !placed.has(edge.to),
      );
      for (const edge of ends.sort((left, right) => byPosition(left.to, right.to)))
        place(edge.to, items);
      const rest = ways
        .filter((edge) => !ends.includes(edge))
        .sort(
          (left, right) =>
            (left.branch ? BRANCH_ORDER[left.branch] : 2) -
              (right.branch ? BRANCH_ORDER[right.branch] : 2) || byPosition(left.to, right.to),
        );
      const back = loopEdges.get(from) ?? [];
      for (const edge of back)
        items.push(
          { type: "add", place: { kind: "edge", edgeId: edge.id } },
          { type: "jump", from, to: edge.to, loop: true },
        );
      const node = byId.get(from);
      const isCondition = node?.kind === "condition";
      if (rest.length === 0 && !isCondition) {
        // A step that sends nothing, such as an output, or one that loops back, has no end to add after.
        if (back.length === 0 && node && node.kind !== "output")
          items.push({ type: "add", place: { kind: "after", nodeId: from } });
        break;
      }
      const next = rest[0];
      if (rest.length === 1 && next && !(isCondition && next.branch)) {
        items.push({ type: "add", place: { kind: "edge", edgeId: next.id } });
        previous = from;
        current = next.to;
        continue;
      }
      // Paths join only when there are two or more: one connected path of a condition goes on alone,
      // and its other answer ends the run.
      const join =
        rest.length > 1
          ? joinOf(
              rest.map((edge) => edge.to),
              stop,
            )
          : undefined;
      const inner = new Set(stop);
      if (join) inner.add(join);
      const paths: FlowPath[] = rest.map((edge) => {
        const items = walk(edge.to, inner, edge);
        return { key: edge.id, branch: edge.branch ?? null, items, goesOn: endedAtStop };
      });
      // A condition shows both of its paths: one that goes nowhere ends the run, and a step can go there.
      if (isCondition)
        for (const branch of ["yes", "no"] as const)
          if (!rest.some((edge) => edge.branch === branch))
            paths.push({
              key: branch,
              branch,
              items: [{ type: "add", place: { kind: "after", nodeId: from, branch } }],
              goesOn: false,
            });
      paths.sort((left, right) => (left.branch === "no" ? 1 : 0) - (right.branch === "no" ? 1 : 0));
      items.push({ type: "split", from, paths, joined: Boolean(join) });
      previous = from;
      current = join;
    }
    // Read by the split that walked this path, right after this call returns.
    endedAtStop = current !== undefined && stop.has(current);
    return items;
  };

  const triggers = steps.filter((node) => node.kind === "trigger").map((node) => node.id);
  const items = triggers.sort(byPosition).flatMap((id) => walk(id, new Set()));
  const loose = steps
    .filter((node) => !placed.has(node.id))
    .map((node) => node.id)
    .sort(byPosition);
  return { items, loose };
}
