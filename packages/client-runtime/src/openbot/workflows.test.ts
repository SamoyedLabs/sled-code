import { expect, it } from "@effect/vitest";
import {
  workflowDraft,
  workflowSaveRequest,
  workflowSaveOutcome,
  workflowSetField,
  workflowConnect,
} from "./workflows.ts";

it("retains unsaved workflow settings on conflict and refuses to edit unknown graph kinds", () => {
  const graph = {
    nodes: [
      {
        id: "prompt",
        kind: "prompt",
        at: { x: 0, y: 0 },
        fields: { text: "Before", font: 16, color: "blue" },
        locked: false,
      },
      { id: "approval", kind: "approval", at: { x: 10, y: 0 }, fields: { question: "Proceed?" } },
    ],
    edges: [],
    strokes: [{ id: "sketch", brush: "pen", color: "red", width: 2, points: [{ x: 1, y: 2 }] }],
  };
  const detail = {
    summary: { id: "one", title: "One", steps: 2, updatedAt: "today", lastRun: null },
    graph,
    revision: 3,
    triggers: [],
  };
  const draft = workflowDraft(detail);
  const edited = workflowSetField(draft.graph, "prompt", "text", "My unsaved change");
  expect(edited.nodes[0]?.fields).toEqual({ text: "My unsaved change", font: 16, color: "blue" });
  expect(edited.strokes).toEqual(graph.strokes);
  const server = {
    ...detail,
    revision: 4,
    graph: {
      ...graph,
      nodes: [{ ...graph.nodes[0]!, fields: { text: "Someone else's change" } }, graph.nodes[1]!],
    },
  };
  const outcome = workflowSaveOutcome({ ...draft, graph: edited }, { ok: false, conflict: server });
  expect(outcome?.state).toBe("conflict");
  if (outcome?.state !== "conflict") return;
  expect(outcome.draft.graph.nodes[0]?.fields.text).toBe("My unsaved change");
  expect(outcome.draft.baseRevision).toBe(3);
  expect(outcome.draft.conflict?.revision).toBe(4);
  expect(workflowSaveRequest(outcome.draft)?.baseRevision).toBe(3);
  const unknown = workflowDraft({
    ...detail,
    graph: { ...graph, nodes: [{ ...graph.nodes[0]!, kind: "future-node" }] },
  });
  expect(workflowSaveRequest(unknown)).toBeNull();
  expect(workflowSetField(unknown.graph, "prompt", "text", "lost")).toEqual(unknown.graph);
});

it("connects only compatible workflow ports and retains condition branches", () => {
  const graph = {
    nodes: [
      { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Input" } },
      { id: "condition", kind: "condition", at: { x: 1, y: 0 }, fields: { rule: "Ready?" } },
      { id: "approval", kind: "approval", at: { x: 2, y: 0 }, fields: { question: "Proceed?" } },
    ],
    edges: [],
    strokes: [],
  };
  expect(
    workflowConnect(graph, { id: "wrong", from: "prompt", to: "approval", type: "image" }),
  ).toBeNull();
  expect(
    workflowConnect(graph, {
      id: "missing-branch",
      from: "condition",
      to: "approval",
      type: "text",
    }),
  ).toBeNull();
  const connected = workflowConnect(graph, {
    id: "yes-edge",
    from: "condition",
    to: "approval",
    type: "text",
    branch: "yes",
  });
  expect(connected?.edges).toEqual([
    { id: "yes-edge", from: "condition", to: "approval", type: "text", branch: "yes" },
  ]);
  expect(
    connected &&
      workflowConnect(connected, {
        id: "again",
        from: "condition",
        to: "approval",
        type: "text",
        branch: "yes",
      }),
  ).toBeNull();
});
