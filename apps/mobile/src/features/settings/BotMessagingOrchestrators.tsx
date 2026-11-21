import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  botConnectionAgents,
  botMessagingOrchestrator,
  botMessagingOrchestratorRequest,
  type BotMessagingPlatform,
} from "@t3tools/client-runtime/openbot/presentation";
import type { BotConnectionPanelProps } from "./useBotConnections";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { T, useGT } from "gt-react-native";

export function MessagingOrchestrators({
  controller: { state, run, busy, setError },
  allowed,
  environmentId,
  hostId,
  platform,
}: BotConnectionPanelProps & {
  environmentId: EnvironmentId;
  hostId: string;
  platform: BotMessagingPlatform;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = botConnectionAgents(query.data);
  const rows = state.messaging[platform]?.connections ?? [];
  const assignments = agents
    ? rows.map((row) => ({
        row,
        agent: botMessagingOrchestrator(platform, row.workspaceId, rows, agents),
      }))
    : [];
  const needsAgent = assignments.find((entry) => entry.agent === null);
  const hasAgent = assignments.some((entry) => entry.agent !== null);
  const setup = async () => {
    if (!needsAgent) return;
    const request = botMessagingOrchestratorRequest(platform, needsAgent.row.workspaceId);
    if (!request) {
      setError(gt("Refresh this connection before setting up its orchestrator."));
      return;
    }
    if (await run([request, { operation: "connector.messaging.overview", platform }]))
      query.refresh();
  };
  return (
    <View className="gap-2 border-t border-border pt-3">
      <Text className="font-t3-medium">
        <T>Orchestrator bots</T>
      </Text>
      <Text className="text-foreground-muted">
        <T>
          An orchestrator answers connected places on this host. Setup reuses a platform's existing
          bot, or creates one with the host's default provider and model.
        </T>
      </Text>
      <Button
        label={gt("Refresh orchestrators")}
        disabled={busy || query.isPending}
        onPress={query.refresh}
      />
      {query.isPending && (
        <Text accessibilityLiveRegion="polite">
          <T>Loading orchestrators…</T>
        </Text>
      )}
      {query.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error}
        </Text>
      )}
      {assignments.map(({ row, agent }) => (
        <Text key={row.workspaceId}>
          {row.workspaceName}:{" "}
          {agent ? `${agent.name} · ${agent.provider} (${agent.id})` : gt("No orchestrator")}
        </Text>
      ))}
      {needsAgent && (
        <Button
          label={hasAgent ? gt("Use existing orchestrator") : gt("Create orchestrator")}
          disabled={!allowed || busy || query.isPending}
          onPress={() => void setup()}
        />
      )}
    </View>
  );
}
