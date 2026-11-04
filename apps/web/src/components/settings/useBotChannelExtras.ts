import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotChannelAdminRequest } from "@t3tools/contracts";
import { channelExtras, channelList } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotChannelExtras(environmentId: EnvironmentId, hostId: string) {
  const [channelId, setChannelId] = useState("");
  const [routineId, setRoutineId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const channels = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.list" } },
    }),
  );
  const memories = useEnvironmentQuery(
    channelId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "channel.memories", channelId } },
        })
      : null,
  );
  const routines = useEnvironmentQuery(
    channelId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "channel.routines", channelId } },
        })
      : null,
  );
  const runs = useEnvironmentQuery(
    channelId && routineId
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "channel.routine.runs", channelId, routineId, limit: 100 },
          },
        })
      : null,
  );
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "channel.memory.clear", channelId: channelId || "permission" },
    }),
  );
  const canRun = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "channel.routine.test",
        channelId: channelId || "permission",
        routineId: routineId || "permission",
      },
    }),
  );
  const command = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const refresh = () => {
    channels.refresh();
    memories.refresh();
    routines.refresh();
    runs.refresh();
  };
  const act = async (request: OpenbotChannelAdminRequest) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await command({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      else refresh();
    } catch {
      setError(
        "The channel request could not complete. Refresh to check the saved state before retrying.",
      );
    }
    lock.current = false;
    setBusy(false);
  };
  return {
    channelId,
    setChannelId: (id: string) => {
      setChannelId(id);
      setRoutineId("");
      setError(null);
    },
    routineId,
    setRoutineId,
    channels: channelList(channels.data),
    memories:
      channelExtras(memories.data, "memories")?.filter(
        (memory) => memory.channelId === channelId,
      ) ?? null,
    routines:
      channelExtras(routines.data, "routines")?.filter(
        (routine) => routine.channelId === channelId,
      ) ?? null,
    runs:
      channelExtras(runs.data, "runs")?.filter(
        (run) => run.channelId === channelId && run.routineId === routineId,
      ) ?? null,
    error: error ?? memories.error ?? routines.error ?? runs.error,
    setError,
    busy,
    canManage,
    canRun,
    act,
    refresh,
  };
}
