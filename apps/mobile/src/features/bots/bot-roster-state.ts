import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, OpenbotAttentionRequest, OpenbotHostStatus } from "@t3tools/contracts";

export type BotRosterWait = OpenbotAttentionRequest["kind"];

// OpenBot mobile gives questions priority over browser takeovers, then approvals.
const waitRank = { approval: 0, takeover: 1, prompt: 2 } satisfies Record<BotRosterWait, number>;

export function botRosterWaits(requests: readonly Pick<OpenbotAttentionRequest, "agentId" | "kind">[]) {
  const waits = new Map<string, BotRosterWait>();
  for (const { agentId, kind } of requests) {
    const previous = waits.get(agentId);
    if (previous === undefined || waitRank[kind] > waitRank[previous]) waits.set(agentId, kind);
  }
  return waits;
}

type RosterEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
};

export function resolveRosterEnvironment<T extends RosterEnvironment>(
  environments: readonly T[],
  selectedId: EnvironmentId | null,
): T | undefined {
  return (
    environments.find((environment) => environment.environmentId === selectedId) ??
    environments.find((environment) => environment.connection.phase === "connected") ??
    environments[0]
  );
}

export function botRosterState({
  catalogReady,
  connection,
  host,
  hostError,
}: {
  catalogReady: boolean;
  connection: EnvironmentConnectionPhase | undefined;
  host: OpenbotHostStatus | null;
  hostError: boolean;
}): "loading" | "empty" | "waiting" | "disabled" | "failed" | "ready" {
  if (!catalogReady) return "loading";
  if (!connection) return "empty";
  if (connection === "connecting") return "loading";
  if (connection !== "connected") return "waiting";
  if (!host) return hostError ? "failed" : "loading";
  if (host.state === "ready" && host.hostId) return "ready";
  if (host.state === "starting") return "loading";
  if (host.state === "disabled" || host.state === "stopped") return "disabled";
  return "failed";
}
