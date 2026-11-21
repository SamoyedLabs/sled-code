import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";

export function sameWorkspaceUploadTarget(
  identity: OpenbotOriginalUploadIdentity,
  target: { hostId: string; agentId: string; taskId: string | null; threadId?: string | undefined },
) {
  return (
    identity.hostId === target.hostId &&
    identity.agentId === target.agentId &&
    identity.taskId === target.taskId &&
    (target.threadId === undefined || identity.threadId === target.threadId)
  );
}

/** Reopening the original bytes reuses the original operation only in its exact destination. */
export function sameWorkspaceUploadFile(
  identity: OpenbotOriginalUploadIdentity,
  file: Omit<OpenbotOriginalUploadIdentity, "operationId">,
) {
  return (
    sameWorkspaceUploadTarget(identity, file) &&
    identity.sha256 === file.sha256 &&
    identity.name === file.name &&
    identity.size === file.size &&
    identity.mimeType === file.mimeType
  );
}

export function workspaceUploadRetry<
  T extends { identity: OpenbotOriginalUploadIdentity; phase: string },
>(
  records: readonly T[],
  file: Omit<OpenbotOriginalUploadIdentity, "operationId">,
  operationId: unknown,
): T | undefined {
  if (typeof operationId === "string") {
    const original = records.find((record) => record.identity.operationId === operationId);
    if (!original || !sameWorkspaceUploadFile(original.identity, file))
      throw new Error("The original file or conversation changed.");
    if (original.phase !== "uploading" && original.phase !== "ready")
      throw new Error("The original upload cannot be retried in its current state.");
    return original;
  }
  return records.find(
    (record) => record.phase === "uploading" && sameWorkspaceUploadFile(record.identity, file),
  );
}
