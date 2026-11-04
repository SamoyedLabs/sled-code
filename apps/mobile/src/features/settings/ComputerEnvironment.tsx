import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useComputerViewActions } from "./ComputerViewActions";
import { BotComputer } from "./BotComputer";
export function ComputerEnvironment({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const viewer = useComputerViewActions(environmentId, hostId);
  const registry = useContext(RegistryContext);
  const canCheckSetup = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "computer.setup" },
    }),
  );
  const read = useAtomCommand(openbot.computerCapabilities, { reportFailure: false });
  const execute = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <BotComputer
      actions={{
        viewer,
        canCheckSetup,
        canSelectDisplay: (displayId) =>
          registry.get(
            openbot.adminToHost.permissionAtom(environmentId, {
              hostId,
              request: { operation: "computer.display", displayId },
            }),
          ),
        capabilities: async () => {
          const result = await read({
            environmentId,
            input: { hostId, request: { operation: "computer.capabilities" } },
          });
          if (result._tag === "Failure") throw new Error("Computer capabilities unavailable");
          return result.value;
        },
        execute: async (request) => {
          const result = await execute({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw new Error("Computer request unavailable");
          return result.value;
        },
      }}
    />
  );
}
