import { useRef, useState } from "react";
import type { Json } from "effect/Schema";
import {
  invalidateSettingGroup,
  settingIsRead,
  settingRequest,
  settingResult,
  type SettingsActions,
} from "@t3tools/client-runtime/openbot/settings";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
export function useBotSettings(actions: SettingsActions) {
  const [results, setResults] = useState<Readonly<Record<string, Json>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const run = async (
    operation: OpenbotSettingsRequest["operation"],
    parameters: Json,
  ): Promise<Json | null> => {
    const request = settingRequest(operation, parameters);
    if (!request || lock.current || !actions.can(request)) return null;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    if (!settingIsRead(request))
      setResults((current) => invalidateSettingGroup(current, operation));
    return (async (): Promise<Json | null> => {
      const value = await actions.execute(request);
      const result = settingResult(operation, value);
      if (result === null && value !== null) throw new Error("Unexpected host result");
      const group = operation.split(".")[1];
      const parametersKey = `parameters:${operation}`;
      const latestKey = `latest:${group}`;
      const latestParametersKey = `latest-parameters:${group}`;
      setResults((current) => ({
        ...current,
        [operation]: result,
        [parametersKey]: parameters,
        [latestKey]: result,
        [latestParametersKey]: parameters,
      }));
      if (!settingIsRead(request))
        setNotice("Saved on the selected host. Refresh to read the current setting.");
      return result;
    })()
      .catch(() => {
        setNotice(
          settingIsRead(request)
            ? "This setting could not be read. Check host support and access."
            : "The connection ended before confirmation. Refresh this setting before changing it again.",
        );
        return null;
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };
  return { results, busy, notice, run };
}
