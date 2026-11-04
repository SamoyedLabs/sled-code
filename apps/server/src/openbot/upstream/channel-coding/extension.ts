/** Maintained Openbot service extension. No HTTP route or runtime capability is implied. */
export interface CodingBinding {
  channelId: string;
  taskId: string;
  taskRevision: number;
  assignmentId: string;
  agentId: string;
  turnId: string;
  requestMessageId: string;
  requesterId: string;
  operationId: string;
}
export interface CodingReceipt {
  binding: CodingBinding;
  result: null | { messageId: string; text: string };
}
export interface CodingActor {
  /** Supplied by a trusted, assignment-scoped transport, never by request JSON. */
  agentId: string;
  turnId: string;
  requesterId: string;
}
export interface CodingSnapshot {
  archived: boolean;
  member: boolean;
  task: {
    id: string;
    revision: number;
    state: string;
    ownerAgentId: string | null;
    requestMessageId: string;
  };
  assignment: {
    id: string;
    taskId: string;
    taskRevision: number;
    agentId: string;
    turnId: string | null;
    state: string;
    requestMessageId: string | null;
  };
  requesterId: string | null;
  receipt: CodingReceipt | null;
  result: { messageId: string; text: string } | null;
}
export interface CodingPort {
  read(binding: CodingBinding): CodingSnapshot;
  /** Commit receipt and optional assistant result in ONE durable channel transaction. */
  commit(receipt: CodingReceipt, writeResult: boolean): void;
}
const fields = [
  "channelId",
  "taskId",
  "assignmentId",
  "agentId",
  "turnId",
  "requestMessageId",
  "requesterId",
  "operationId",
] as const;
export function decodeCodingReceipt(value: unknown): CodingReceipt {
  if (typeof value !== "object" || value === null || !("binding" in value) || !("result" in value))
    throw new Error("Invalid coding receipt.");
  const binding = value.binding;
  if (typeof binding !== "object" || binding === null) throw new Error("Invalid coding binding.");
  for (const field of fields) {
    if (!(field in binding)) throw new Error("Missing coding identity.");
    const item = Reflect.get(binding, field);
    if (typeof item !== "string" || !item.length || item.length > 512)
      throw new Error("Invalid coding identity.");
  }
  if (
    !("taskRevision" in binding) ||
    !Number.isSafeInteger(binding.taskRevision) ||
    Number(binding.taskRevision) < 0
  )
    throw new Error("Invalid task revision.");
  if (
    value.result !== null &&
    (typeof value.result !== "object" ||
      !("messageId" in value.result) ||
      typeof value.result.messageId !== "string" ||
      !value.result.messageId.length ||
      !("text" in value.result) ||
      typeof value.result.text !== "string" ||
      !value.result.text.trim() ||
      value.result.text.length > 100_000)
  )
    throw new Error("Invalid coding result.");
  // Validation is kept independent of the host's Effect major version.
  return value as CodingReceipt;
}
function same(a: CodingBinding, b: CodingBinding): boolean {
  return a.taskRevision === b.taskRevision && fields.every((field) => a[field] === b[field]);
}

/** Synchronous: no yield between current-assignment validation and the durable commit. */
export function channelCoding(
  port: CodingPort,
  actor: CodingActor,
  binding: CodingBinding,
  action: "bind" | "receipt" | "submit",
  text?: string,
): CodingReceipt | null {
  decodeCodingReceipt({ binding, result: null });
  const view = port.read(binding);
  if (
    !view.member ||
    actor.agentId !== binding.agentId ||
    actor.turnId !== binding.turnId ||
    actor.requesterId !== binding.requesterId ||
    view.requesterId !== binding.requesterId
  )
    throw new Error("Coding authority mismatch.");
  const assignment = view.assignment;
  if (
    assignment.id !== binding.assignmentId ||
    assignment.agentId !== binding.agentId ||
    assignment.turnId !== binding.turnId ||
    assignment.taskId !== binding.taskId ||
    assignment.taskRevision !== binding.taskRevision ||
    assignment.requestMessageId !== binding.requestMessageId
  )
    throw new Error("Coding assignment mismatch.");
  const receipt = view.receipt;
  if (receipt && !same(receipt.binding, binding)) throw new Error("Coding operation conflict.");
  // Historical receipt reads reconcile uncertain submission without reviving old work.
  if (action === "receipt") return receipt;
  if (
    view.archived ||
    assignment.state !== "running" ||
    view.task.id !== binding.taskId ||
    view.task.state !== "running" ||
    view.task.revision !== binding.taskRevision ||
    view.task.ownerAgentId !== binding.agentId ||
    view.task.requestMessageId !== binding.requestMessageId
  )
    throw new Error("Coding assignment is stale.");
  if (action === "bind") {
    if (receipt) return receipt;
    if (view.result) throw new Error("The assignment already has a result.");
    const next = { binding, result: null };
    port.commit(next, false);
    return next;
  }
  if (!receipt) throw new Error("Bind the coding operation first.");
  if (typeof text !== "string" || !text.trim() || text.length > 100_000)
    throw new Error("Invalid coding result.");
  const messageId = `channel-result-${binding.assignmentId}-revision-${binding.taskRevision}`;
  if (receipt.result) {
    if (
      receipt.result.text !== text ||
      receipt.result.messageId !== messageId ||
      view.result?.text !== text ||
      view.result.messageId !== messageId
    )
      throw new Error("Coding result conflict.");
    return receipt;
  }
  if (view.result) throw new Error("The assignment already has a result.");
  const next = { binding, result: { messageId, text } };
  port.commit(next, true);
  return next;
}
