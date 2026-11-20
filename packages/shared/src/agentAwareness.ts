import {
  isListedThreadLineage,
  type EnvironmentId,
  type OrchestrationV2ThreadShell,
  type Project,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { backgroundWorkHoldsCompletion } from "./orchestrationV2PendingBackgroundWork.ts";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export interface ProjectThreadAwarenessV2Input {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<Project, "title">;
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    | "activityRunStatus"
    | "id"
    | "lineage"
    | "latestRunStopRequested"
    | "modelSelection"
    | "pendingBackgroundTasks"
    | "pendingRuntimeRequest"
    | "settledOverride"
    | "status"
    | "title"
    | "updatedAt"
  >;
}

export function projectThreadAwarenessV2(
  input: ProjectThreadAwarenessV2Input,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  if (!isListedThreadLineage(thread.lineage)) return null;
  const phase = resolveThreadAwarenessPhaseV2(thread);
  if (phase === null) {
    return null;
  }
  if (phase === "completed" && thread.latestRunStopRequested === true) return null;
  // Resolve the phase first so live or waiting work stays visible after settlement.
  if (
    thread.settledOverride === "settled" &&
    (phase === "completed" || phase === "failed") &&
    !backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
  ) {
    return null;
  }
  const detail =
    phase === "completed"
      ? "Review the completed task."
      : phase === "failed"
        ? "The agent run failed."
        : undefined;
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: DateTime.formatIso(thread.updatedAt),
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function resolveThreadAwarenessPhaseV2(
  thread: ProjectThreadAwarenessV2Input["thread"],
): AgentAwarenessPhase | null {
  if (thread.pendingRuntimeRequest?.kind === "user_input") return "waiting_for_input";
  if (
    thread.pendingRuntimeRequest !== null &&
    thread.pendingRuntimeRequest.kind !== "auth_refresh"
  ) {
    return "waiting_for_approval";
  }
  switch (thread.activityRunStatus ?? thread.status) {
    case "preparing":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      return backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
        ? "running"
        : "completed";
    case "failed":
      return "failed";
    case "idle":
    case "queued":
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return null;
  }
}

function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Agent finished";
    case "failed":
      return "Agent failed";
    case "stale":
      return "Update delayed";
  }
}

export interface BotNotificationTarget {
  readonly kind: "bot";
  readonly environmentId: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly taskId?: string | undefined;
  readonly channelId?: string | undefined;
  readonly routineId?: string | undefined;
  readonly routineRunId?: string | undefined;
}

export function botNotificationDeepLink(target: BotNotificationTarget): string | null {
  if (
    (target.taskId !== undefined && target.routineId !== undefined) ||
    (target.routineRunId !== undefined && target.routineId === undefined)
  )
    return null;
  const ids = [target.environmentId, target.hostId, target.agentId];
  if (target.taskId !== undefined) ids.push(target.taskId);
  if (target.channelId !== undefined) ids.push(target.channelId);
  if (target.routineId !== undefined) ids.push(target.routineId);
  if (target.routineRunId !== undefined) ids.push(target.routineRunId);
  if (ids.some((id) => id.length === 0 || id.length > 512)) return null;
  try {
    return `/bots/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.hostId)}/${encodeURIComponent(target.agentId)}${target.taskId === undefined ? "" : `/tasks/${encodeURIComponent(target.taskId)}`}${target.routineId === undefined ? "" : `/routines/${encodeURIComponent(target.routineId)}${target.routineRunId === undefined ? "" : `/runs/${encodeURIComponent(target.routineRunId)}`}`}${target.channelId === undefined ? "" : `/channels/${encodeURIComponent(target.channelId)}`}`;
  } catch {
    return null;
  }
}

export function parseBotNotificationDeepLink(value: string): BotNotificationTarget | null {
  if (value.trim() !== value || value.includes("?") || value.includes("#")) return null;
  const match =
    /^\/bots\/([^/]+)\/([^/]+)\/([^/]+)(?:\/tasks\/([^/]+))?(?:\/routines\/([^/]+)(?:\/runs\/([^/]+))?)?(?:\/channels\/([^/]+))?$/.exec(
      value,
    );
  if (!match) return null;
  try {
    const target: BotNotificationTarget = {
      kind: "bot",
      environmentId: decodeURIComponent(match[1] ?? ""),
      hostId: decodeURIComponent(match[2] ?? ""),
      agentId: decodeURIComponent(match[3] ?? ""),
      ...(match[4] === undefined ? {} : { taskId: decodeURIComponent(match[4]) }),
      ...(match[5] === undefined ? {} : { routineId: decodeURIComponent(match[5]) }),
      ...(match[6] === undefined ? {} : { routineRunId: decodeURIComponent(match[6]) }),
      ...(match[7] === undefined ? {} : { channelId: decodeURIComponent(match[7]) }),
    };
    return botNotificationDeepLink(target) === null ? null : target;
  } catch {
    return null;
  }
}
