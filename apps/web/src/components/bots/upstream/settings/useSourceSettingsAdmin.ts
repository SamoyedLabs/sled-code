import { useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import * as Option from "effect/Option";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  settingRequest,
  settingIsRead,
  settingResult,
} from "@t3tools/client-runtime/openbot/settings";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import type { Json } from "effect/Schema";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
export function useSourceSettingsAdmin(environmentId: EnvironmentId, hostId: string) {
  const registry = useContext(RegistryContext);
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const command = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const fresh = () => Boolean(connection && readPreparedConnection(environmentId) === connection);
  const can = (request: OpenbotAdminRequest) =>
    fresh() && registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }));
  const execute = async (request: OpenbotAdminRequest) => {
    if (!fresh()) throw new Error("Reconnect the original host session before continuing.");
    if (!can(request)) throw new Error("You do not have permission to change this host setting.");
    const result = await command({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (!fresh()) throw new Error("The host session changed. Reload before continuing.");
    return result.value;
  };
  const canSetting = (operation: OpenbotSettingsRequest["operation"], parameters: Json = {}) => {
    const request = settingRequest(operation, parameters);
    return Boolean(
      request &&
      fresh() &&
      (settingIsRead(request)
        ? registry.get(openbot.settingsRead.permissionAtom(environmentId, { hostId, request }))
        : can(request)),
    );
  };
  const setting = async (
    operation: OpenbotSettingsRequest["operation"],
    parameters: Json = {},
  ): Promise<unknown> => {
    const request = settingRequest(operation, parameters);
    if (!request || !canSetting(operation, parameters))
      throw new Error("You do not have permission to use this host setting.");
    const raw = settingIsRead(request)
      ? await (async () => {
          const result = await read({ environmentId, input: { hostId, request } });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value;
        })()
      : await execute(request);
    if (!fresh()) throw new Error("The host session changed. Reload before continuing.");
    const value = settingResult(operation, raw);
    if (value === null) throw new Error("The host returned an unsupported setting response.");
    return value;
  };
  return { connection, can, execute, canSetting, setting };
}
