import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";
import { notificationRoutineRuns } from "@t3tools/client-runtime/openbot/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { AppText as Text } from "../../components/ui/AppText";
import { T } from "gt-react-native";
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
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "routine.runs", agentId, routineId } },
    }),
  );
  const runs = notificationRoutineRuns(query.data, routineId, runId);
  return (
    <View className="gap-2">
      <Text className="font-semibold">
        <T>Routine result</T>
      </Text>
      {query.isPending && (
        <Text accessibilityRole="status">
          <T>Loading routine history…</T>
        </Text>
      )}
      {query.error && <Text accessibilityRole="alert">{query.error}</Text>}
      {runs?.map((run) => (
        <View className="gap-1" key={run.id}>
          <Text>
            {run.routineName} · {run.status}
          </Text>
          <Text>{run.updatedAt}</Text>
          {run.error && <Text accessibilityRole="alert">{run.error}</Text>}
        </View>
      ))}
      {runs?.length === 0 && (
        <Text>
          <T>
            This run is outside the host’s retained history or is no longer available. The
            notification cannot establish its current outcome.
          </T>
        </Text>
      )}
    </View>
  );
}
