import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { computerViewerUrl } from "@t3tools/client-runtime/openbot/presentation";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { openbot } from "../../state/openbot";
export function useComputerViewActions(environmentId: EnvironmentId, hostId: string) {
  const registry = useContext(RegistryContext);
  const canOpen = useAtomValue(
    openbot.computerViewCommand.permissionAtom(environmentId, {
      operation: "open",
      frameOrigin: window.location.origin,
      hostId,
    }),
  );
  return {
    canOpen,
    open: async () => {
      const accessAtom = openbot.computerViewAccess({ environmentId, input: {} });
      registry.refresh(accessAtom);
      const access = await Effect.runPromise(
        AtomRegistry.getResult(registry, accessAtom, { suspendOnWaiting: true }).pipe(
          Effect.timeout("10 seconds"),
        ),
      );
      const options = { reportFailure: false, reportDefect: false };
      const result = await runAtomCommand(
        registry,
        openbot.computerViewCommand,
        {
          environmentId,
          input: { operation: "open", frameOrigin: window.location.origin, hostId },
        },
        options,
      );
      if (result._tag === "Failure" || !result.value) throw new Error("Computer unavailable");
      const grant = result.value;
      const close = async () => {
        const stopped = await runAtomCommand(
          registry,
          openbot.computerViewCommand,
          { environmentId, input: { operation: "close", hostId, id: grant.id } },
          options,
        );
        if (stopped._tag === "Failure") throw new Error("Computer stop failed");
      };
      try {
        return {
          canClose: () =>
            registry.get(
              openbot.computerViewCommand.permissionAtom(environmentId, {
                operation: "close",
                hostId,
                id: grant.id,
              }),
            ),
          id: grant.id,
          url: computerViewerUrl(access, grant, hostId, Date.now()),
          close,
        };
      } catch {
        await close();
        throw new Error("Computer viewer unavailable");
      }
    },
  };
}
