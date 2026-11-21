import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { BotData } from "./BotData";
export function DataEnvironment({
  environmentId,
  hostId,
  workspace = false,
  view,
  modal,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  workspace?: boolean;
  view?: "tables" | "sites";
  modal?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const agents = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const registry = useContext(RegistryContext);
  const canReadTables = useAtomValue(
    openbot.dataRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "tables.list" },
    }),
  );
  const canReadSites = useAtomValue(
    openbot.dataRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "sites.list" },
    }),
  );
  const read = useAtomCommand(openbot.dataRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <BotData
      key={`${environmentId}:${hostId}`}
      workspace={workspace}
      view={view}
      modal={modal}
      agents={agents.data ?? []}
      actions={{
        canReadTables,
        canReadSites,
        canDelete: (request) =>
          registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })),
        execute: async (request) => {
          const result =
            request.operation === "tables.delete" || request.operation === "sites.delete"
              ? await admin({ environmentId, input: { hostId, request } })
              : await read({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value;
        },
      }}
    />
  );
}
