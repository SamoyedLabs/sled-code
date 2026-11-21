import { describe, expect, it } from "vite-plus/test";
import type { OpenbotWorkflowGraph } from "@t3tools/contracts";
import { insertAtPlace, placeKinds } from "./workflow-flow-edit";
import { workflowFlowTree, workflowLoopEdges } from "./workflow-flow-tree";

const node = (id: string, kind: string, x: number, y = 0) => ({
  id,
  kind,
  at: { x, y },
  fields: {},
});
const edge = (id: string, from: string, to: string, branch?: "yes" | "no") => ({
  id,
  from,
  to,
  type: "text",
  ...(branch ? { branch } : {}),
});
const graph: OpenbotWorkflowGraph = {
  nodes: [
    node("trigger", "trigger", 0),
    node("condition", "condition", 300),
    node("a", "agent", 600),
    node("b", "approval", 600, 250),
    node("join", "llm", 900),
  ],
  edges: [
    edge("begin", "trigger", "condition"),
    edge("yes", "condition", "a", "yes"),
    edge("no", "condition", "b", "no"),
    edge("a-join", "a", "join"),
    edge("b-join", "b", "join"),
    edge("repeat", "join", "condition"),
  ],
  strokes: [],
};

describe("the mobile workflow flow", () => {
  it("shows yes and no in order, joins the paths, and visits the loop once", () => {
    expect([...workflowLoopEdges(graph.nodes, graph.edges)]).toEqual(["repeat"]);
    const flow = workflowFlowTree(graph);
    expect(flow.loose).toEqual([]);
    expect(flow.items).toContainEqual({
      type: "split",
      from: "condition",
      joined: true,
      paths: [
        expect.objectContaining({ branch: "yes", goesOn: true }),
        expect.objectContaining({ branch: "no", goesOn: true }),
      ],
    });
    expect(flow.items).toContainEqual({ type: "jump", from: "join", to: "condition", loop: true });
  });

  it("inserts a condition on the chosen no edge and retains every unrelated edge", () => {
    const place = { kind: "edge", edgeId: "no" } as const;
    expect(placeKinds(graph, place, ["condition"])).toEqual(["condition"]);
    let id = 0;
    const next = insertAtPlace(
      graph,
      place,
      "condition",
      node("second", "condition", 0),
      () => `new-${++id}`,
    );
    expect(next?.edges).toEqual([
      ...graph.edges.filter((connection) => connection.id !== "no"),
      edge("new-1", "condition", "second", "no"),
      edge("new-2", "second", "b", "yes"),
    ]);
    expect(
      insertAtPlace(
        graph,
        { kind: "edge", edgeId: "missing" },
        "condition",
        node("extra", "condition", 0),
        () => "bad",
      ),
    ).toBeNull();
  });
});
