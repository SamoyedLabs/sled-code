import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotRoutineFlowCommand } from "@t3tools/contracts";
import {
  channelList,
  workflowAgents,
  routineFlowCanvas,
} from "@t3tools/client-runtime/openbot/presentation";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotRoutineDiscovery(environmentId: EnvironmentId, hostId: string) {
  const agents = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const channels = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.list" } },
    }),
  );
  return {
    agents: workflowAgents(agents.data),
    channels: (channelList(channels.data) ?? []).filter((channel) => !channel.archived),
    error: agents.error ?? channels.error,
    refresh: () => {
      agents.refresh();
      channels.refresh();
    },
  };
}

export function useBotRoutineFlows(environmentId: EnvironmentId, hostId: string, agentId: string) {
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const includeOneTime = settingsCapabilities(compatibility.data).includes("sled-once-routines-v1");
  const target = {
    environmentId,
    input: {
      hostId,
      request: {
        operation: "routineFlow.canvas" as const,
        agentId,
        ...(includeOneTime ? { includeOneTime: true } : {}),
      },
    },
  };
  const query = useEnvironmentQuery(agentId ? openbot.readFromHost(target) : null);
  const reload = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const tail = useRef(Promise.resolve());
  const count = useRef(0);
  const act = (request: OpenbotRoutineFlowCommand): Promise<boolean> => {
    const connection = readPreparedConnection(environmentId);
    count.current++;
    setBusy(true);
    const work = tail.current
      .then(async () => {
        setError(null);
        const settled = await settlePromise(async () => {
          if (!connection || readPreparedConnection(environmentId) !== connection)
            throw new Error("The original host session changed.");
          const response = await write({ environmentId, input: { hostId, request } });
          if (response._tag === "Failure")
            throw new Error(
              "The flow change was refused. Check your permissions for every bot in this flow.",
            );
          const fresh = await reload(target);
          if (fresh._tag === "Failure")
            throw new Error("The change was sent, but the refreshed canvas could not be read.");
        });
        if (settled._tag === "Failure")
          setError("The flow change could not be confirmed. Refresh the canvas before continuing.");
        return settled._tag === "Success";
      })
      .finally(() => {
        count.current--;
        setBusy(count.current > 0);
      });
    tail.current = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  };
  return {
    canvas: routineFlowCanvas(query.data),
    loading: query.isPending,
    error: error ?? query.error,
    refresh: query.refresh,
    busy,
    canWrite,
    act,
  };
}
