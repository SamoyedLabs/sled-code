import type { EnvironmentId } from "@t3tools/contracts";
import { notificationRoutineRuns } from "@t3tools/client-runtime/openbot/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { T, useGT } from "gt-react";
export function BotRoutineNotification({
  environmentId,
  hostId,
  agentId,
  routineId,
  runId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  routineId: string;
  runId?: string;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "routine.runs", agentId, routineId } },
    }),
  );
  const runs = notificationRoutineRuns(query.data, routineId, runId);
  return (
    <section className="space-y-2" aria-label={gt("Routine notification")}>
      <h3 className="text-sm font-medium">
        <T>Routine result</T>
      </h3>
      {query.isPending && (
        <p role="status">
          <T>Loading routine history…</T>
        </p>
      )}
      {query.error && <p role="alert">{query.error}</p>}
      {runs?.map((run) => (
        <article className="space-y-1" key={run.id}>
          <p>
            {run.routineName} · {run.status}
          </p>
          <p className="text-xs">{run.updatedAt}</p>
          {run.error && <p role="alert">{run.error}</p>}
        </article>
      ))}
      {runs?.length === 0 && (
        <p role="status">
          <T>
            This run is outside the host’s retained history or is no longer available. The
            notification cannot establish its current outcome.
          </T>
        </p>
      )}
    </section>
  );
}
