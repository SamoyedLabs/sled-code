import { AppState } from "react-native";
import { useEffect, useRef, useState } from "react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { computerCapabilities, computerSetup } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";
import { m } from "../../i18n/messages";
import { msg, useGT } from "gt-react-native";

export function useBotComputer(actions: ComputerActions) {
  const gt = useGT();
  const generation = useRef(0);
  const active = useRef(true);
  const owned = useRef<{
    id: string;
    url: string;
    canClose: () => boolean;
    close: () => Promise<void>;
  } | null>(null);
  const [viewer, setViewer] = useState<typeof owned.current>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the externally owned desktop lease when the panel unmounts.
  useEffect(
    () => () => {
      generation.current++;
      const current = owned.current;
      owned.current = null;
      void current?.close().catch(() => {});
    },
    [],
  );
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ReturnType<typeof computerCapabilities>>(null);
  const [setup, setSetup] = useState<ReturnType<typeof computerSetup>>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Suspend the owned remote-input lease when this client becomes hidden.
  useEffect(() => {
    const suspend = (visible: boolean) => {
      active.current = visible;
      if (visible) return;
      generation.current++;
      const current = owned.current;
      owned.current = null;
      setViewer(null);
      lock.current = false;
      setBusy(false);
      void current
        ?.close()
        .catch(() => setError(m(msg("The viewer could not stop. Its server lease will expire."))));
    };
    suspend(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      suspend(state === "active"),
    );
    return () => subscription.remove();
  }, []);
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
      setError(gt("The computer request failed. Refresh host capabilities before retrying."));
    }
    lock.current = false;
    setBusy(false);
  };
  const openViewer = async () => {
    if (!active.current || lock.current || !actions.viewer?.canOpen || owned.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const started = generation.current;
    const result = await settlePromise(() => actions.viewer!.open());
    if (started !== generation.current) {
      if (result._tag === "Success") void result.value.close().catch(() => {});
      return;
    }
    if (result._tag === "Success") {
      owned.current = result.value;
      setViewer(result.value);
    } else setError(gt("The computer viewer could not start. Check host setup and retry."));
    lock.current = false;
    setBusy(false);
  };
  const closeViewer = async () => {
    if (lock.current || !owned.current) return;
    lock.current = true;
    setBusy(true);
    const current = owned.current;
    const result = await settlePromise(() => current.close());
    if (result._tag === "Success") {
      owned.current = null;
      setViewer(null);
    } else setError(gt("The viewer could not stop. Retry to close your session."));
    lock.current = false;
    setBusy(false);
  };
  return {
    viewer,
    openViewer: () => void openViewer(),
    closeViewer: () => void closeViewer(),
    capabilities,
    setup,
    busy,
    error,
    refresh: () => void run("capabilities"),
    checkSetup: () => void run("setup"),
    selectDisplay: (displayId: string) => void run("display", displayId),
  };
}
