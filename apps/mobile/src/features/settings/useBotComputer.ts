import { useRef, useState } from "react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { computerCapabilities, computerSetup } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";

export function useBotComputer(actions: ComputerActions) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ReturnType<typeof computerCapabilities>>(null);
  const [setup, setSetup] = useState<ReturnType<typeof computerSetup>>(null);
  const run = async (operation: "capabilities" | "setup" | "display", displayId?: string) => {
    if (
      lock.current ||
      (operation === "setup" && !actions.canCheckSetup) ||
      (operation === "display" && (!displayId || !actions.canSelectDisplay(displayId)))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await settlePromise(async () => {
      if (operation === "setup") {
        setSetup(null);
        const next = computerSetup(await actions.execute({ operation: "computer.setup" }));
        if (!next) return false;
        setSetup(next);
      } else {
        setCapabilities(null);
        if (operation === "display" && displayId) {
          setSetup(null);
          await actions.execute({ operation: "computer.display", displayId });
        }
        const next = computerCapabilities(await actions.capabilities());
        if (!next) return false;
        setCapabilities(next);
      }
      return true;
    });
    if (result._tag === "Failure" || !result.value) {
      setCapabilities(null);
      setSetup(null);
      setError("The computer request failed. Refresh host capabilities before retrying.");
    }
    lock.current = false;
    setBusy(false);
  };
  return {
    capabilities,
    setup,
    busy,
    error,
    refresh: () => void run("capabilities"),
    checkSetup: () => void run("setup"),
    selectDisplay: (displayId: string) => void run("display", displayId),
  };
}
