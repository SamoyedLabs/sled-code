/** Maintained Openbot service extension. No HTTP route or runtime capability is implied. */
// @effect-diagnostics-next-line extendsNativeError:off
class ChannelCodingAuthorityError extends Error {
  override readonly name = "ChannelCodingAuthorityError";
}
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
export interface CodingProgress {
  eventId: string;
  status: "executing" | "needs_input" | "needs_approval";
  updatedAt: string;
}
export interface CodingProgressReceipt extends CodingProgress {
  delivery: "accepted" | "rejected" | "uncertain";
}
function decodeCodingProgress(value: unknown): CodingProgress {
  if (
    !isCodingObject(value) ||
    !("eventId" in value) ||
    !("status" in value) ||
    !("updatedAt" in value) ||
    typeof value.eventId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.eventId) ||
    (value.status !== "executing" &&
      value.status !== "needs_input" &&
      value.status !== "needs_approval") ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw new Error("Invalid coding progress.");
  return {
    eventId: value.eventId,
    status: value.status,
    updatedAt: value.updatedAt,
  };
}
export interface CodingReceipt {
  progress?: CodingProgressReceipt[];
  binding: CodingBinding;
  /** Engine-private: never projected into tool arguments/results or model history. */
  attestation?: {
    credentialHash: string;
    originRef: string | null;
    requesterKind: "session" | "routine" | "agent";
    payloadHash: string;
    /** Definitive first-attempt refusal; no external coding work was accepted. */
    refused?: true;
  };
  result: null | { messageId: string; text: string };
  /** Absent on old receipts: old bindings never acquire a lease by replay. */
  lease?: { reservedAt: number; renewedAt?: number; expiresAt: number; providerCompleted: boolean };
}
export interface CodingActor {
  /** Supplied by a trusted, assignment-scoped transport, never by request JSON. */
  agentId: string;
  turnId: string;
  requesterId: string;
}
export interface CodingSnapshot {
  channelId: string;
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
  now(): number;
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
function isCodingObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function codingIdentifier(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512)
    throw new Error("Invalid coding identity.");
  return value;
}
export function decodeCodingReceipt(value: unknown): CodingReceipt {
  if (!isCodingObject(value) || !("binding" in value) || !("result" in value))
    throw new Error("Invalid coding receipt.");
  const source = value.binding;
  if (
    !isCodingObject(source) ||
    !("taskRevision" in source) ||
    !("channelId" in source) ||
    !("taskId" in source) ||
    !("assignmentId" in source) ||
    !("agentId" in source) ||
    !("turnId" in source) ||
    !("requestMessageId" in source) ||
    !("requesterId" in source) ||
    !("operationId" in source)
  )
    throw new Error("Invalid coding binding.");
  if (
    typeof source.taskRevision !== "number" ||
    !Number.isSafeInteger(source.taskRevision) ||
    source.taskRevision < 0
  )
    throw new Error("Invalid task revision.");
  const binding: CodingBinding = {
    channelId: codingIdentifier(source.channelId),
    taskId: codingIdentifier(source.taskId),
    taskRevision: source.taskRevision,
    assignmentId: codingIdentifier(source.assignmentId),
    agentId: codingIdentifier(source.agentId),
    turnId: codingIdentifier(source.turnId),
    requestMessageId: codingIdentifier(source.requestMessageId),
    requesterId: codingIdentifier(source.requesterId),
    operationId: codingIdentifier(source.operationId),
  };
  let result: CodingReceipt["result"] = null;
  if (value.result !== null) {
    if (
      !isCodingObject(value.result) ||
      !("messageId" in value.result) ||
      !("text" in value.result) ||
      typeof value.result.messageId !== "string" ||
      !value.result.messageId.length ||
      typeof value.result.text !== "string" ||
      !value.result.text.trim() ||
      value.result.text.length > 100_000
    )
      throw new Error("Invalid coding result.");
    result = { messageId: value.result.messageId, text: value.result.text };
  }
  let lease: CodingReceipt["lease"];
  if ("lease" in value) {
    const source = value.lease;
    if (
      !isCodingObject(source) ||
      !("reservedAt" in source) ||
      !("expiresAt" in source) ||
      !("providerCompleted" in source) ||
      typeof source.reservedAt !== "number" ||
      !Number.isSafeInteger(source.reservedAt) ||
      source.reservedAt < 0 ||
      typeof source.expiresAt !== "number" ||
      !Number.isSafeInteger(source.expiresAt) ||
      source.expiresAt <= source.reservedAt ||
      ("renewedAt" in source &&
        (typeof source.renewedAt !== "number" ||
          !Number.isSafeInteger(source.renewedAt) ||
          source.renewedAt < source.reservedAt ||
          source.renewedAt >= source.expiresAt)) ||
      source.expiresAt -
        ("renewedAt" in source && typeof source.renewedAt === "number"
          ? source.renewedAt
          : source.reservedAt) >
        30 * 60_000 ||
      typeof source.providerCompleted !== "boolean"
    )
      throw new Error("Invalid coding lease.");
    lease = {
      reservedAt: source.reservedAt,
      ...("renewedAt" in source && typeof source.renewedAt === "number"
        ? { renewedAt: source.renewedAt }
        : {}),
      expiresAt: source.expiresAt,
      providerCompleted: source.providerCompleted,
    };
  }
  let attestation: CodingReceipt["attestation"];
  if ("attestation" in value) {
    const a = value.attestation;
    if (
      !isCodingObject(a) ||
      !("credentialHash" in a) ||
      !("originRef" in a) ||
      !("requesterKind" in a) ||
      !("payloadHash" in a) ||
      typeof a.credentialHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.credentialHash) ||
      (a.originRef !== null &&
        (typeof a.originRef !== "string" || !/^[a-f0-9]{64}$/.test(a.originRef))) ||
      (a.requesterKind !== "session" &&
        a.requesterKind !== "routine" &&
        a.requesterKind !== "agent") ||
      typeof a.payloadHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.payloadHash)
    )
      throw new Error("Invalid coding attestation.");
    if ("refused" in a && a.refused !== true) throw new Error("Invalid coding refusal.");
    attestation = {
      credentialHash: a.credentialHash,
      originRef: a.originRef,
      requesterKind: a.requesterKind,
      payloadHash: a.payloadHash,
      ...("refused" in a ? { refused: true as const } : {}),
    };
  }
  return {
    binding,
    result,
    ...("progress" in value
      ? {
          progress: (() => {
            if (!Array.isArray(value.progress)) throw new Error("Invalid progress receipts.");
            const ids = new Set<string>();
            return value.progress.map((entry: unknown): CodingProgressReceipt => {
              const event = decodeCodingProgress(entry);
              if (
                !isCodingObject(entry) ||
                !("delivery" in entry) ||
                (entry.delivery !== "accepted" &&
                  entry.delivery !== "rejected" &&
                  entry.delivery !== "uncertain") ||
                ids.has(event.eventId)
              )
                throw new Error("Invalid progress receipt.");
              ids.add(event.eventId);
              return { ...event, delivery: entry.delivery };
            });
          })(),
        }
      : {}),
    ...(lease === undefined ? {} : { lease }),
    ...(attestation === undefined ? {} : { attestation }),
  };
}
function same(a: CodingBinding, b: CodingBinding): boolean {
  return a.taskRevision === b.taskRevision && fields.every((field) => a[field] === b[field]);
}

/** Synchronous: no yield between current-assignment validation and the durable commit. */
export function channelCoding(
  port: CodingPort,
  actor: CodingActor,
  binding: CodingBinding,
  action: "bind" | "receipt" | "submit" | "renew" | "refuse",
  text?: string,
): CodingReceipt | null {
  decodeCodingReceipt({ binding, result: null });
  const view = port.read(binding);
  if (
    view.channelId !== binding.channelId ||
    !view.member ||
    actor.agentId !== binding.agentId ||
    actor.turnId !== binding.turnId ||
    actor.requesterId !== binding.requesterId ||
    view.requesterId !== binding.requesterId
  )
    throw new ChannelCodingAuthorityError("Coding authority mismatch.");
  const assignment = view.assignment;
  if (
    assignment.id !== binding.assignmentId ||
    assignment.agentId !== binding.agentId ||
    assignment.turnId !== binding.turnId ||
    assignment.taskId !== binding.taskId ||
    assignment.taskRevision !== binding.taskRevision ||
    assignment.requestMessageId !== binding.requestMessageId
  )
    throw new ChannelCodingAuthorityError("Coding assignment mismatch.");
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
    throw new ChannelCodingAuthorityError("Coding assignment is stale.");
  if (receipt?.attestation?.refused)
    throw new ChannelCodingAuthorityError("Coding request was refused.");
  if (action === "refuse") {
    if (!receipt?.attestation || receipt.result || view.result)
      throw new ChannelCodingAuthorityError("Coding reservation cannot refuse.");
    const next: CodingReceipt = {
      ...receipt,
      attestation: { ...receipt.attestation, refused: true },
    };
    port.commit(next, false);
    return next;
  }
  const now = port.now();
  if (receipt?.lease && now >= receipt.lease.expiresAt)
    throw new ChannelCodingAuthorityError("Coding lease expired.");
  if (action === "renew") {
    if (!receipt?.lease || receipt.result)
      throw new ChannelCodingAuthorityError("Coding reservation cannot renew.");
    const next = {
      ...receipt,
      lease: { ...receipt.lease, renewedAt: now, expiresAt: now + 30 * 60_000 },
    };
    decodeCodingReceipt(next);
    port.commit(next, false);
    return next;
  }
  if (action === "bind") {
    if (receipt) return receipt;
    if (view.result) throw new Error("The assignment already has a result.");
    const next: CodingReceipt = {
      binding,
      result: null,
      lease: { reservedAt: now, expiresAt: now + 30 * 60_000, providerCompleted: false },
    };
    decodeCodingReceipt(next);
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
  const next = { ...receipt, result: { messageId, text } };
  port.commit(next, true);
  return next;
}

/** Completion/recovery share the same durable decision; no process-local keepalive. */
export function codingLifetime(
  view: CodingSnapshot,
  now: number,
  status: string,
): "hold" | "complete" | "interrupt" {
  const receipt = view.receipt;
  if (!receipt?.lease || receipt.attestation?.refused || status !== "completed") return "complete";
  const b = receipt.binding;
  const a = view.assignment;
  if (
    view.channelId !== b.channelId ||
    view.archived ||
    !view.member ||
    view.requesterId !== b.requesterId ||
    a.id !== b.assignmentId ||
    a.taskId !== b.taskId ||
    a.taskRevision !== b.taskRevision ||
    a.agentId !== b.agentId ||
    a.turnId !== b.turnId ||
    a.requestMessageId !== b.requestMessageId ||
    a.state !== "running" ||
    view.task.id !== b.taskId ||
    view.task.revision !== b.taskRevision ||
    view.task.state !== "running" ||
    view.task.ownerAgentId !== b.agentId ||
    view.task.requestMessageId !== b.requestMessageId
  )
    return "interrupt";
  if (receipt.result || view.result) return "complete"; // A provider result always wins its existing slot.
  return now >= receipt.lease.expiresAt ? "interrupt" : "hold";
}
