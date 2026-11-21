import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotCatalog } from "./BotCatalog";
export function CatalogEnvironment({
  environmentId,
  hostId,
  onChange,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onChange: () => void;
}) {
  const registry = useContext(RegistryContext);
  const canRead = useAtomValue(
    openbot.catalogRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "registry.status" },
    }),
  );
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "registry.cancel", registryId: "permission-check" },
    }),
  );
  const read = useAtomCommand(openbot.catalogRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <BotCatalog
      actions={{
        can: (request) =>
          request.operation === "registry.install" ||
          request.operation === "registry.cancel" ||
          request.operation === "registry.remove"
            ? canAdmin &&
              registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }))
            : canRead &&
              registry.get(openbot.catalogRead.permissionAtom(environmentId, { hostId, request })),
        execute: async (request) => {
          const result =
            request.operation === "registry.install" ||
            request.operation === "registry.cancel" ||
            request.operation === "registry.remove"
              ? await admin({ environmentId, input: { hostId, request } })
              : await read({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw new Error("Host registry request failed");
          if (request.operation === "registry.installed") onChange();
          return result.value;
        },
      }}
    />
  );
}
