import type { EnvironmentId, RunId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { SupervisorConnectionState } from "../connection/model.ts";
import { enabledEnvironmentIds, type EnvironmentCatalogState } from "./connections.ts";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";

export interface MascotActivity {
  readonly state: "sleeping" | "working" | "attention" | "error" | "offline";
  readonly completionKey: string | null;
}

export const MASCOT_ACTIVITY_LABELS: Readonly<Record<MascotActivity["state"], string>> = {
  sleeping: "Sleeping",
  working: "Working",
  attention: "Needs your attention",
  error: "Run failed",
  offline: "Disconnected",
};

type MascotThread = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "archivedAt"
  | "deletedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "runtime"
  | "latestRun"
  | "lastVisitedAt"
  | "settledOverride"
  | "settledAt"
>;

interface MascotObservation {
  readonly activity: MascotActivity;
  readonly activeRuns: ReadonlyMap<string, RunId>;
}

function hasUnseenFailure(thread: MascotThread): boolean {
  if (thread.runtime?.status !== "failed" || thread.settledOverride === "settled") return false;
  const failedAt = thread.latestRun?.completedAt ?? thread.runtime.updatedAt;
  return (
    (thread.lastVisitedAt == null || thread.lastVisitedAt < failedAt) &&
    (thread.settledAt === null || thread.settledAt < failedAt)
  );
}

export function createMascotActivityAtom<E>(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, E>>;
  readonly threadShellsAtom: Atom.Atom<ReadonlyArray<MascotThread>>;
}): Atom.Atom<MascotActivity> {
  const observationAtom = Atom.make((get): MascotObservation => {
    const previous = Option.getOrUndefined(get.self<MascotObservation>());
    const connected = new Set<EnvironmentId>();
    let enabledCount = 0;
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      enabledCount++;
      const state = get(input.connectionStateAtom(environmentId));
      if (AsyncResult.isSuccess(state) && state.value.phase === "connected") {
        connected.add(environmentId);
      }
    }

    let attention = false;
    let working = false;
    let failed = false;
    let completionKey = previous?.activity.completionKey ?? null;
    const activeRuns = new Map<string, RunId>();
    for (const thread of get(input.threadShellsAtom)) {
      if (
        !connected.has(thread.environmentId) ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null
      ) {
        continue;
      }
      const key = JSON.stringify([thread.environmentId, thread.id]);
      const active = threadRuntimeIsActive(thread.runtime);
      attention ||=
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput ||
        thread.pendingSubagentRequest != null ||
        (thread.pendingGuestMessageCount ?? 0) > 0 ||
        (!active && thread.interactionMode === "plan" && thread.hasActionableProposedPlan);
      working ||= active;
      failed ||= hasUnseenFailure(thread);
      const run = thread.latestRun;
      const activeRunId = thread.runtime?.activeRunId ?? run?.runId;
      if (active && activeRunId !== undefined) activeRuns.set(key, activeRunId);
      // Only an observed live run can celebrate; snapshots and reconnections are not new completions.
      if (!active && run?.status === "completed" && previous?.activeRuns.get(key) === run.runId) {
        completionKey = JSON.stringify([thread.environmentId, thread.id, run.runId]);
      }
    }
    const state: MascotActivity["state"] = attention
      ? "attention"
      : working
        ? "working"
        : failed
          ? "error"
          : enabledCount > 0 && connected.size === 0
            ? "offline"
            : "sleeping";
    const activity =
      previous?.activity.state === state && previous.activity.completionKey === completionKey
        ? previous.activity
        : { state, completionKey };
    return { activity, activeRuns };
  }).pipe(Atom.withLabel("mascot-activity-observation"));
  return Atom.map(observationAtom, (observation) => observation.activity).pipe(
    Atom.withLabel("mascot-activity"),
  );
}
