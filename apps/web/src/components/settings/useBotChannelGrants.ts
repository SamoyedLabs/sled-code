import { randomUUID } from "../../lib/utils";
import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  IsoDateTime,
  type EnvironmentId,
  type OpenbotChannelGrant,
  type OpenbotChannelGrantCommand,
} from "@t3tools/contracts";
import { channelGrantList } from "@t3tools/client-runtime/openbot/channelGrants";
import {
  botCodingPolicyView,
  workflowAgents,
  channelExtras,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
export type ChannelGrantsProps = {
  environmentId: EnvironmentId;
  hostId: string;
  channelId: string;
  agentId: string;
};
export function useBotChannelGrants(props: ChannelGrantsProps) {
  const [kind, setKind] = useState<"routine" | "agent">("routine");
  const [requester, setRequester] = useState("");
  const [hours, setHours] = useState("24");
  const [grants, setGrants] = useState<readonly OpenbotChannelGrant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const approval = useRef<{ key: string; operationId: string; expiresAt: IsoDateTime } | null>(
    null,
  );
  const policy = useEnvironmentQuery(
    openbot.codingPolicy({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, agentId: props.agentId },
    }),
  );
  const defaults = botCodingPolicyView(policy.data)?.defaults;
  const routineQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: props.environmentId,
      input: {
        hostId: props.hostId,
        request: { operation: "channel.routines", channelId: props.channelId },
      },
    }),
  );
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request: { operation: "agent.list" } },
    }),
  );
  const choices =
    kind === "routine"
      ? (channelExtras(routineQuery.data, "routines") ?? []).map((row) => ({
          id: `routine:${row.id}`,
          name: row.name,
        }))
      : workflowAgents(agentsQuery.data).map((row) => ({ id: `agent:${row.id}`, name: row.name }));
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(props.environmentId, {
      hostId: props.hostId,
      request: { operation: "channel.grants", command: { action: "list", hostId: props.hostId } },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const run = async (command: OpenbotChannelGrantCommand) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await admin({
        environmentId: props.environmentId,
        input: { hostId: props.hostId, request: { operation: "channel.grants", command } },
      });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      else {
        setGrants(channelGrantList(result.value));
        if (command.action === "create") approval.current = null;
      }
    } catch {
      setError("The permission request could not complete. Refresh before approving again.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const duration = Number(hours);
  const valid =
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= 720 &&
    choices.some((choice) => choice.id === requester);
  return {
    kind,
    setKind,
    choices,
    requester,
    setRequester,
    hours,
    setHours,
    busy,
    error,
    canManage,
    defaults,
    valid,
    grants: grants.filter((g) => g.agentId === props.agentId && g.channelId === props.channelId),
    refresh: () => run({ action: "list", hostId: props.hostId }),
    approve: () => {
      if (defaults && valid) {
        const key = JSON.stringify({ kind, requester, hours, defaults });
        if (approval.current?.key !== key)
          approval.current = {
            key,
            operationId: randomUUID(),
            expiresAt: IsoDateTime.make(new Date(Date.now() + duration * 3600000).toISOString()),
          };
        void run({
          action: "create",
          operationId: approval.current.operationId,
          hostId: props.hostId,
          agentId: props.agentId,
          channelId: props.channelId,
          requesterKind: kind,
          requesterId: requester,
          defaults,
          expiresAt: approval.current.expiresAt,
        });
      }
    },
    revoke: (id: string) => run({ action: "revoke", hostId: props.hostId, id }),
  };
}
