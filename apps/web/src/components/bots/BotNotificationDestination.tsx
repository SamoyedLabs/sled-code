import type { OpenbotNotificationTarget } from "@t3tools/contracts";
import { BotDetail } from "./BotEnvironment";
import { BotChannels } from "../settings/BotChannels";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { useGT } from "gt-react";
export function BotNotificationDestination({ target }: { target: OpenbotNotificationTarget }) {
  const gt = useGT();
  const host = useEnvironmentQuery(
    openbot.status({ environmentId: target.environmentId, input: {} }),
  );
  const agents = useEnvironmentQuery(
    host.data?.state === "ready" && host.data.hostId === target.hostId
      ? openbot.agents({ environmentId: target.environmentId, input: {} })
      : null,
  );
  const agent = agents.data?.find((item) => item.id === target.agentId);
  if (host.data?.state !== "ready" || host.data.hostId !== target.hostId || !agent)
    return (
      <p role="status">
        {host.isPending || agents.isPending
          ? gt("Connecting to the notification’s bot…")
          : host.error ||
            agents.error ||
            gt(
              "This bot or host is unavailable. Reconnect its environment to review the notification.",
            )}
      </p>
    );
  if (target.channelId)
    return (
      <BotChannels
        environmentId={target.environmentId}
        hostId={target.hostId}
        initialChannelId={target.channelId}
        {...(target.taskId === undefined ? {} : { initialTaskId: target.taskId })}
      />
    );
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{agent.name}</h2>
      <BotDetail
        environmentId={target.environmentId}
        expectedHostId={target.hostId}
        agentId={target.agentId}
        {...(target.taskId === undefined ? {} : { initialTaskId: target.taskId })}
        {...(target.routineId === undefined ? {} : { initialRoutineId: target.routineId })}
        {...(target.routineRunId === undefined ? {} : { initialRoutineRunId: target.routineRunId })}
      />
    </section>
  );
}
