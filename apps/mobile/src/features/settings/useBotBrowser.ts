import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { browserDisplay, browserProfiles } from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotBrowser(environmentId: EnvironmentId, hostId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const canControl = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "browser.display" },
    }),
  );
  const [display, setDisplay] = useState<ReturnType<typeof browserDisplay>>(null);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [profiles, setProfiles] = useState<ReturnType<typeof browserProfiles>>(null);
  const act = async (request: OpenbotAdminRequest) => {
    if (lock.current || !canControl) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const result = await admin({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") {
        setDisplay(null);
        setProfiles(null);
        setError("The browser request failed. Refresh before retrying.");
        return;
      } else if (request.operation === "browser.display") setDisplay(browserDisplay(result.value));
      else if (request.operation === "browser.profiles.list")
        setProfiles(browserProfiles(result.value));
      if (
        request.operation.startsWith("browser.profiles.") &&
        request.operation !== "browser.profiles.list"
      ) {
        const next = await admin({
          environmentId,
          input: { hostId, request: { operation: "browser.profiles.list" } },
        });
        if (next._tag === "Success") setProfiles(browserProfiles(next.value));
      }
      if (request.operation !== "browser.display") {
        const next = await admin({
          environmentId,
          input: { hostId, request: { operation: "browser.display" } },
        });
        if (next._tag === "Success") setDisplay(browserDisplay(next.value));
      }
    });
    if (settled._tag === "Failure") {
      setDisplay(null);
      setProfiles(null);
      setError("The browser request failed. Refresh before retrying.");
    }
    lock.current = false;
    setBusy(false);
  };
  return {
    display: canControl ? display : null,
    profiles: canControl ? profiles : null,
    canControl,
    busy,
    error,
    act,
    refresh: () => void act({ operation: "browser.display" }),
  };
}
