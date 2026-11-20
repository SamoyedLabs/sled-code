import type { OpenbotChange, OpenbotReadRequest } from "@t3tools/contracts";

export interface ChangeScope {
  readonly resources: readonly OpenbotChange["resource"][];
  readonly agentId?: string;
  readonly taskId?: string;
}

export function changeScopeForRead(input: OpenbotReadRequest): ChangeScope {
  const operation = input.operation;
  if (operation === "library.folders.read") return { resources: ["library"] };
  if (operation === "library.files.list" || operation === "library.files.preview")
    return { resources: ["library", "agents"] };
  if (operation === "routineFlow.canvas") return { resources: ["routines", "activity", "agents"] };
  const agentId = "agentId" in input ? input.agentId : undefined;
  const taskId = "taskId" in input && typeof input.taskId === "string" ? input.taskId : undefined;
  if (operation === "context.read") return { resources: ["activity"], agentId: input.agentId };
  const resources: ChangeScope["resources"] = operation.startsWith("conversation.")
    ? [taskId ? "tasks" : "conversation", "activity", "attention"]
    : operation.startsWith("task.") || operation.startsWith("thread.")
      ? ["tasks", "queue", "activity"]
      : operation.startsWith("agent.")
        ? ["agents", "configuration", "activity"]
        : operation.startsWith("memory.")
          ? ["memory"]
          : operation.startsWith("routine.") || operation.startsWith("events.")
            ? ["routines"]
            : operation.startsWith("queue.")
              ? ["queue", "activity"]
              : operation.startsWith("browser.")
                ? ["browser"]
                : operation === "workspace.sidebar"
                  ? ["agents", "configuration"]
                  : operation === "workspace.reads"
                    ? ["agents", "conversation", "tasks", "queue", "activity", "configuration"]
                    : operation.startsWith("channel.")
                      ? ["conversation", "memory", "routines", "activity", "configuration"]
                      : ["configuration"];
  return { resources, ...(agentId ? { agentId } : {}), ...(taskId ? { taskId } : {}) };
}

// Cumulative versions survive a replaced sliding notification for another resource.
export function changeToken(change: OpenbotChange, scope: ChangeScope): unknown {
  if (!change.versions) return change;
  const selected = Object.entries(change.versions).filter(([key]) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      return true;
    }
    if (!Array.isArray(parsed)) return true;
    const [resource, agentId, taskId]: unknown[] = parsed;
    return (
      resource === "all" ||
      (scope.resources.some((candidate) => candidate === resource) &&
        (!scope.agentId || !agentId || agentId === scope.agentId) &&
        (!scope.taskId || !taskId || taskId === scope.taskId))
    );
  });
  return JSON.stringify([change.hostId, change.epoch ?? 0, selected]);
}
