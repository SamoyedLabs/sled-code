import { useContext, useEffect, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  OpenbotEventRoutine,
  type EnvironmentId,
  type OpenbotAgent,
  type OpenbotChannelSummary,
} from "@t3tools/contracts";
import { routineViews } from "@t3tools/client-runtime/openbot/presentation";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { openbot } from "../../state/openbot";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";
import { readPreparedConnection, usePreparedConnection } from "../../state/session";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { SearchRoutine } from "./upstream/search/GlobalSearch";

const decodeRoutines = Schema.decodeUnknownSync(Schema.Array(OpenbotEventRoutine));
type Owner = { kind: "agent" | "channel"; id: string; name: string };

export function useBotRoutineIndex({
  enabled,
  environmentId,
  hostId,
  agents,
  channels = [],
}: {
  enabled: boolean;
  environmentId: EnvironmentId | null;
  hostId: string | null;
  agents: readonly Pick<typeof OpenbotAgent.Type, "id" | "name">[];
  channels?: readonly Pick<OpenbotChannelSummary, "id" | "name">[];
}) {
  const registry = useContext(RegistryContext);
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const read = useStableCallback(
    useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true }),
  );
  const admin = useStableCallback(useAtomCommand(openbot.adminToHost, { reportFailure: false }));
  const owners: Owner[] = [
    ...agents.map((a) => ({ kind: "agent" as const, id: a.id, name: a.name })),
    ...channels.map((c) => ({ kind: "channel" as const, id: c.id, name: c.name })),
  ];
  const [revision, setRevision] = useState(0);
  const refresh = useStableCallback(() => setRevision((value) => value + 1));
  const ownerKey = JSON.stringify(owners);
  const scope = JSON.stringify([environmentId, hostId, ownerKey, revision]);
  const [state, setState] = useState<{
    scope: string;
    items: readonly SearchRoutine[];
    pending: boolean;
    failed: boolean;
    connection: object | null;
  }>({ scope: "", items: [], pending: false, failed: false, connection: null });
  const load = useStableCallback(async (current: () => boolean) => {
    if (!environmentId || !hostId || !connection) return;
    const fresh = () => current() && readPreparedConnection(environmentId) === connection;
    const compatibility = await read({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    });
    if (!fresh()) return;
    const capabilities =
      compatibility._tag === "Success" ? settingsCapabilities(compatibility.value) : [];
    const includeOneTime = capabilities.includes("sled-once-routines-v1");
    const hasEvents =
      includeOneTime ||
      capabilities.includes("routine-recovery-v1") ||
      capabilities.includes("events-v1");
    const items: SearchRoutine[] = [];
    let failed = false;
    // Bound host fanout: searching a large roster must not open one request per bot at once.
    for (let offset = 0; offset < owners.length && fresh(); offset += 4) {
      const batches = await Promise.all(
        owners.slice(offset, offset + 4).map(async (owner) => {
          try {
            if (!fresh()) return [];
            const request = {
              operation: "events.list" as const,
              owner: { kind: owner.kind, id: owner.id },
              ...(includeOneTime && owner.kind === "agent" ? { includeOneTime: true } : {}),
            };
            const permitted =
              hasEvents &&
              registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }));
            if (permitted) {
              const result = await admin({ environmentId, input: { hostId, request } });
              if (result._tag === "Failure") throw Error("Routine discovery failed");
              return decodeRoutines(result.value)
                .filter((r) => r.owner.kind === owner.kind && r.owner.id === owner.id)
                .map((r) => ({
                  id: r.id,
                  name: r.name,
                  detail: owner.name,
                  ...(owner.kind === "agent" ? { agentId: owner.id } : { channelId: owner.id }),
                }));
            }
            if (owner.kind === "channel") return [];
            const result = await read({
              environmentId,
              input: { hostId, request: { operation: "routine.list", agentId: owner.id } },
            });
            if (result._tag === "Failure") throw Error("Routine discovery failed");
            const routines = routineViews(result.value);
            if (!routines) throw Error("Invalid routine discovery response");
            return routines.map((r) => ({
              id: r.id,
              name: r.name,
              agentId: owner.id,
              detail: owner.name,
            }));
          } catch {
            failed = true;
            return [];
          }
        }),
      );
      if (!fresh()) return;
      items.push(...batches.flat());
    }
    if (fresh()) setState({ scope, items, pending: false, failed, connection });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Discover host-owned routine summaries only for an open search; drop responses from a replaced host/session or closed overlay.
  useEffect(() => {
    if (!enabled || !environmentId || !hostId || !connection) return;
    let current = true;
    void load(() => current).catch(() => {
      if (current && readPreparedConnection(environmentId) === connection)
        setState({ scope, items: [], pending: false, failed: true, connection });
    });
    return () => {
      current = false;
    };
  }, [enabled, environmentId, hostId, connection, scope, load]);
  return {
    ...(enabled && state.scope === scope && state.connection === connection
      ? state
      : {
          scope,
          items: [],
          pending: Boolean(enabled && connection && owners.length),
          failed: false,
          connection,
        }),
    refresh,
  };
}
