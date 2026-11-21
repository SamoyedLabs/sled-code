import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingIsRead, settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotSettings } from "./BotSettings";
export function BotSettingsEnvironment({
  environmentId,
  hostId,
  agentId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
}) {
  const registry = useContext(RegistryContext);
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.host-timezone.settings", parameters: {} },
    }),
  );
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.host-timezone.update", parameters: { timezone: null } },
    }),
  );
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <BotSettings
      key={JSON.stringify([environmentId, hostId, agentId ?? null])}
      agentId={agentId}
      capabilities={settingsCapabilities(compatibility.data)}
      actions={{
        can: (request) =>
          settingIsRead(request)
            ? canRead &&
              registry.get(openbot.settingsRead.permissionAtom(environmentId, { hostId, request }))
            : canAdmin &&
              registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })),
        execute: async (request) => {
          const result = settingIsRead(request)
            ? await read({ environmentId, input: { hostId, request } })
            : await admin({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw new Error("Bot setting request failed");
          return result.value;
        },
      }}
    />
  );
}
