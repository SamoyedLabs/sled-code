import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  settingIsRead,
  settingsCapabilities,
  type SettingsActions,
} from "@t3tools/client-runtime/openbot/settings";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
export function useSourceSettingsActions(environmentId: EnvironmentId, hostId: string) {
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
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const actions: SettingsActions = {
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
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
  };
  return { actions, capabilities: settingsCapabilities(compatibility.data) };
}
