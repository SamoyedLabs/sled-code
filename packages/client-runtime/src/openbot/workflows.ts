import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotAgentList,
  OpenbotWorkflowDetail,
  OpenbotWorkflowGraph,
  OpenbotWorkflowSummary,
  OpenbotWorkflowVersion,
  OpenbotWorkflowRunPage,
  OpenbotWorkflowRunDetail,
  OpenbotWorkflowSaveResult,
  type OpenbotWorkflowAdminRequest,
} from "@t3tools/contracts";

const decodeAgents = Schema.decodeUnknownResult(OpenbotAgentList);
export function workflowAgents(value: unknown) {
  const result = decodeAgents(value);
  return Result.isSuccess(result) ? result.success : [];
}
const decodeDetail = Schema.decodeUnknownResult(OpenbotWorkflowDetail);
const decodeList = Schema.decodeUnknownResult(
  Schema.Struct({ workflows: Schema.Array(OpenbotWorkflowSummary) }),
);
const decodeVersions = Schema.decodeUnknownResult(
  Schema.Struct({ versions: Schema.Array(OpenbotWorkflowVersion) }),
);
const decodeRuns = Schema.decodeUnknownResult(OpenbotWorkflowRunPage);
const decodeRun = Schema.decodeUnknownResult(OpenbotWorkflowRunDetail);
const decodeSave = Schema.decodeUnknownResult(OpenbotWorkflowSaveResult);
const decodeGraph = Schema.decodeUnknownResult(Schema.Struct({ graph: OpenbotWorkflowGraph }));
export function workflowDetail(value: unknown) {
  const result = decodeDetail(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function workflowList(value: unknown) {
  const result = decodeList(value);
  return Result.isSuccess(result) ? result.success.workflows : null;
}
export function workflowVersions(value: unknown) {
  const result = decodeVersions(value);
  return Result.isSuccess(result) ? result.success.versions : null;
}
export function workflowRuns(value: unknown) {
  const result = decodeRuns(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function workflowRun(value: unknown) {
  const result = decodeRun(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function workflowVersionGraph(value: unknown) {
  const result = decodeGraph(value);
  return Result.isSuccess(result) ? result.success.graph : null;
}

export const WORKFLOW_NODE_CHOICES = [
  "prompt",
  "agent",
  "llm",
  "approval",
  "condition",
  "output",
  "trigger",
  "asset",
  "image",
  "text",
  "note",
  "shape",
] as const;
type NodeKind = (typeof WORKFLOW_NODE_CHOICES)[number];
const ports: Readonly<Record<NodeKind, { in: readonly string[]; out: readonly string[] }>> = {
  trigger: { in: [], out: ["text"] },
  prompt: { in: [], out: ["text"] },
  asset: { in: [], out: ["text", "image", "file"] },
  llm: { in: ["text", "image", "file"], out: ["text"] },
  agent: { in: ["text", "image", "file"], out: ["text"] },
  image: { in: ["text", "image"], out: ["image"] },
  condition: { in: ["text"], out: ["text"] },
  approval: { in: ["text"], out: ["text"] },
  output: { in: ["text", "image", "file"], out: [] },
  text: { in: [], out: [] },
  note: { in: [], out: [] },
  shape: { in: [], out: [] },
};
function knownKind(kind: string): kind is NodeKind {
  return Object.hasOwn(ports, kind);
}
export function workflowEditable(graph: OpenbotWorkflowGraph) {
  return (
    graph.nodes.every((node) => knownKind(node.kind)) &&
    graph.edges.every((edge) => ["text", "image", "file"].includes(edge.type))
  );
}
export type WorkflowDraft = {
  readonly workflowId: string;
  readonly baseRevision: number;
  readonly graph: OpenbotWorkflowGraph;
  readonly conflict: OpenbotWorkflowDetail | null;
};
export function workflowDraft(detail: OpenbotWorkflowDetail): WorkflowDraft {
  return {
    workflowId: detail.summary.id,
    baseRevision: detail.revision,
    graph: detail.graph,
    conflict: null,
  };
}
export function workflowSaveRequest(
  draft: WorkflowDraft,
): Extract<OpenbotWorkflowAdminRequest, { operation: "workflow.saveGraph" }> | null {
  return workflowEditable(draft.graph)
    ? {
        operation: "workflow.saveGraph",
        workflowId: draft.workflowId,
        baseRevision: draft.baseRevision,
        graph: draft.graph,
      }
    : null;
}
export function workflowSaveOutcome(draft: WorkflowDraft, value: unknown) {
  const result = decodeSave(value);
  if (!Result.isSuccess(result)) return null;
  return result.success.ok
    ? { state: "saved" as const, revision: result.success.revision }
    : { state: "conflict" as const, draft: { ...draft, conflict: result.success.conflict } };
}
export function workflowSetField(
  graph: OpenbotWorkflowGraph,
  nodeId: string,
  key: string,
  value: string | number | boolean,
): OpenbotWorkflowGraph {
  if (!workflowEditable(graph)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId && !node.locked
        ? { ...node, fields: { ...node.fields, [key]: value } }
        : node,
    ),
  };
}
export function workflowRemoveNode(
  graph: OpenbotWorkflowGraph,
  nodeId: string,
): OpenbotWorkflowGraph {
  if (!workflowEditable(graph) || graph.nodes.find((node) => node.id === nodeId)?.locked)
    return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
  };
}
export function workflowAddNode(
  graph: OpenbotWorkflowGraph,
  kind: string,
  id: string,
): OpenbotWorkflowGraph {
  if (
    !workflowEditable(graph) ||
    !knownKind(kind) ||
    graph.nodes.length >= 200 ||
    graph.nodes.some((node) => node.id === id)
  )
    return graph;
  const fields: Readonly<Record<NodeKind, Readonly<Record<string, string>>>> = {
    prompt: { text: "" },
    agent: { agentId: "", task: "" },
    llm: { provider: "", model: "", prompt: "", system: "" },
    approval: { question: "Continue?" },
    condition: { rule: "" },
    output: { target: "notify" },
    trigger: { trigger: "manual", timezone: "UTC" },
    asset: { file: "" },
    image: { prompt: "" },
    text: { text: "" },
    note: { text: "" },
    shape: { text: "" },
  };
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id, kind, at: { x: graph.nodes.length * 240, y: 0 }, fields: fields[kind] },
    ],
  };
}
export function workflowConnect(
  graph: OpenbotWorkflowGraph,
  edge: OpenbotWorkflowGraph["edges"][number],
): OpenbotWorkflowGraph | null {
  if (
    !workflowEditable(graph) ||
    graph.edges.length >= 400 ||
    graph.edges.some(
      (current) =>
        current.id === edge.id ||
        (current.from === edge.from &&
          current.to === edge.to &&
          current.type === edge.type &&
          current.branch === edge.branch),
    )
  )
    return null;
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  if (
    !from ||
    !to ||
    from.id === to.id ||
    !knownKind(from.kind) ||
    !knownKind(to.kind) ||
    !ports[from.kind].out.includes(edge.type) ||
    !ports[to.kind].in.includes(edge.type)
  )
    return null;
  if (from.kind === "condition" ? !edge.branch : edge.branch !== undefined) return null;
  return { ...graph, edges: [...graph.edges, edge] };
}
export function workflowNodeTitle(graph: OpenbotWorkflowGraph, nodeId: string) {
  const index = graph.nodes.findIndex((node) => node.id === nodeId);
  const node = graph.nodes[index];
  return node
    ? `${index + 1}. ${node.kind === "llm" ? "Model" : node.kind === "agent" ? "Bot" : node.kind}`
    : "Removed step";
}
export function workflowRunCanStop(status: string) {
  return ["running", "approval", "stopping"].includes(status);
}

export function workflowExecutable(graph: OpenbotWorkflowGraph) {
  return (
    workflowEditable(graph) &&
    !graph.nodes.some(
      (node) =>
        node.kind === "asset" ||
        node.kind === "image" ||
        (node.kind === "trigger" && node.fields.trigger === "message") ||
        (node.kind === "output" && node.fields.target === "file"),
    )
  );
}

export function workflowFieldLabel(field: string) {
  const names: Readonly<Record<string, string>> = {
    agentId: "Bot",
    task: "Assignment",
    provider: "Provider",
    model: "Model",
    effort: "Reasoning effort",
    prompt: "Prompt",
    system: "Instructions",
    question: "Question",
    rule: "Condition",
    target: "Output destination",
    trigger: "Trigger",
    timezone: "Time zone",
    text: "Text",
    file: "File",
    connectionId: "Connection",
    placeId: "Channel",
    repository: "Repository",
    titleText: "Title filter",
    labelsFrom: "Label source",
  };
  return (
    names[field] ??
    field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function workflowCanRunNode(node: OpenbotWorkflowGraph["nodes"][number]) {
  return (
    knownKind(node.kind) &&
    !["text", "note", "shape", "asset", "image"].includes(node.kind) &&
    !(node.kind === "trigger" && node.fields.trigger === "message") &&
    !(node.kind === "output" && node.fields.target === "file")
  );
}
