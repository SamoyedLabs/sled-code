import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingIsRead, settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotSettings } from "./BotSettings";
import { BotConfiguration } from "./BotConfiguration";
import { BotProviderSettings } from "./BotProviderSettings";
import { BotCodingPolicy } from "./BotCodingPolicy";
import { Button } from "../ui/button";

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
  if (compatibility.error)
    return (
      <div role="alert" className="space-y-3 rounded-xl bg-muted/30 p-6">
        <p className="text-sm text-destructive">
          Settings could not be loaded from this host. {compatibility.error}
        </p>
        <Button size="sm" variant="outline" onClick={compatibility.refresh}>
          Try again
        </Button>
      </div>
    );
  if (compatibility.isPending && !compatibility.data)
    return (
      <div role="status" aria-busy="true" className="space-y-4 p-6">
        <div className="h-5 w-36 rounded bg-muted" />
        <div className="h-16 rounded-xl bg-muted/50" />
        <div className="h-16 rounded-xl bg-muted/50" />
        <p className="text-sm text-muted-foreground">
          Loading {agentId ? "bot" : "host"} settings…
        </p>
      </div>
    );
  return (
    <BotSettings
      key={JSON.stringify([environmentId, hostId, agentId ?? null])}
      agentId={agentId}
      capabilities={settingsCapabilities(compatibility.data)}
      content={
        agentId
          ? {
              general: (
                <BotConfiguration environmentId={environmentId} hostId={hostId} agentId={agentId} />
              ),
              models: (
                <BotProviderSettings
                  environmentId={environmentId}
                  hostId={hostId}
                  agentId={agentId}
                />
              ),
              workspace: (
                <BotCodingPolicy environmentId={environmentId} hostId={hostId} agentId={agentId} />
              ),
            }
          : {}
      }
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
