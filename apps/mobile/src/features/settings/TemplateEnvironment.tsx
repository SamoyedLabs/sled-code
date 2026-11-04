import { decodeTemplateAgents } from "@t3tools/client-runtime/openbot/templates";
import { useEnvironmentQuery } from "../../state/query";
import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotTemplates } from "./BotTemplates";
export function TemplateEnvironment({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const registry = useContext(RegistryContext);
  const canRead = useAtomValue(
    openbot.templateRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "templates.preview", agentId: "permission-check" },
    }),
  );
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "templates.publish", agentId: "permission-check" },
    }),
  );
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = decodeTemplateAgents(agentsQuery.data);
  const read = useAtomCommand(openbot.templateRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <BotTemplates
      scopeKey={JSON.stringify([environmentId, hostId])}
      hostLabel={hostId}
      agents={agents}
      actions={{
        can: (request) =>
          request.operation !== "templates.preview" &&
          request.operation !== "templates.detail" &&
          request.operation !== "templates.listing"
            ? canAdmin &&
              registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }))
            : canRead &&
              registry.get(openbot.templateRead.permissionAtom(environmentId, { hostId, request })),
        execute: async (request) => {
          const result =
            request.operation !== "templates.preview" &&
            request.operation !== "templates.detail" &&
            request.operation !== "templates.listing"
              ? await admin({ environmentId, input: { hostId, request } })
              : await read({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw new Error("Host template request failed");
          if (!request.operation.startsWith("templates.preview")) agentsQuery.refresh();
          return result.value;
        },
      }}
    />
  );
}
