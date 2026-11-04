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
import { Button } from "../ui/button";

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
      setError("Refresh this connection before setting up its orchestrator.");
      return;
    }
    if (await run([request, { operation: "connector.messaging.overview", platform }]))
      query.refresh();
  };
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Orchestrator bots</p>
      <p className="text-sm text-muted-foreground">
        An orchestrator answers connected places on this host. Setup reuses a platform's existing
        bot, or creates one with the host's default provider and model.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || query.isPending}
        onClick={query.refresh}
      >
        Refresh orchestrators
      </Button>
      {query.isPending && (
        <p role="status" className="text-sm">
          Loading orchestrators…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      )}
      {assignments.map(({ row, agent }) => (
        <p key={row.workspaceId} className="text-sm">
          {row.workspaceName}:{" "}
          {agent ? `${agent.name} · ${agent.provider} (${agent.id})` : "No orchestrator"}
        </p>
      ))}
      {needsAgent && (
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy || query.isPending}
          onClick={() => void setup()}
        >
          {hasAgent ? "Use existing orchestrator" : "Create orchestrator"}
        </Button>
      )}
    </div>
  );
}
