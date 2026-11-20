import { useEffect, useEffectEvent, useRef } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { useComputerViewActions } from "../../settings/ComputerViewActions";
import { useAtomCommand } from "../../../state/use-atom-command";
import { openbot } from "../../../state/openbot";

export function useWorkspaceComputer(environmentId: EnvironmentId, hostId: string) {
  const actions = useComputerViewActions(environmentId, hostId);
  const capabilities = useAtomCommand(openbot.computerCapabilities, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const generation = useRef(0);
  const opening = useRef(false);
  const owned = useRef<Awaited<ReturnType<typeof actions.open>> | null>(null);
  const close = useStableCallback(async () => {
    generation.current++;
    const lease = owned.current;
    await lease?.close();
    if (owned.current === lease) owned.current = null;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release remote input when the owning client is hidden.
  useEffect(() => {
    const changed = () => {
      if (document.hidden) void close().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, [close]);
  const handle = useEffectEvent(async (method: string, args: Record<string, unknown>) => {
    if (method === "computer-available") return actions.canOpen;
    if (method === "computer-close") {
      if (owned.current?.id === args.id) await close();
      return null;
    }
    if (method === "computer-display") {
      if (typeof args.displayId !== "string" || !args.displayId || args.displayId.length > 128)
        throw new Error("Invalid computer display");
      const result = await admin({
        environmentId,
        input: { hostId, request: { operation: "computer.display", displayId: args.displayId } },
      });
      if (result._tag === "Failure") throw new Error("Computer display selection refused");
      return null;
    }
    if (method !== "computer-open") throw new Error("Unsupported computer action");
    if (!actions.canOpen)
      throw new Error("Computer control requires desktop access for this connection.");
    if (opening.current || document.hidden)
      throw new Error("Computer viewer is not available while opening or hidden.");
    opening.current = true;
    try {
      await close();
      const current = generation.current;
      const result = await capabilities({
        environmentId,
        input: { hostId, request: { operation: "computer.capabilities" } },
      });
      if (result._tag === "Failure" || current !== generation.current)
        throw new Error("Computer capabilities unavailable");
      const lease = await actions.open();
      if (current !== generation.current) {
        await lease.close();
        throw new Error("The computer view changed while opening");
      }
      owned.current = lease;
      return { id: lease.id, url: lease.url, capabilities: result.value };
    } finally {
      opening.current = false;
    }
  });
  return { handle, close, available: actions.canOpen };
}
