import { useRef, useState } from "react";
import type { OpenbotCatalogRequest } from "@t3tools/contracts/openbot-catalog";
import {
  EMPTY_CATALOG,
  catalogRecovered,
  catalogResult,
  catalogRequestValid,
  type CatalogActions,
} from "@t3tools/client-runtime/openbot/catalog";
export function useBotCatalog(actions: CatalogActions) {
  const [state, setState] = useState(EMPTY_CATALOG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const run = async (request: OpenbotCatalogRequest) => {
    if (lock.current || !catalogRequestValid(request) || !actions.can(request)) return;
    const mutation =
      request.operation !== "registry.search" &&
      request.operation !== "registry.installed" &&
      request.operation !== "registry.status";
    if (mutation && uncertain) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const next = await actions
      .execute(request)
      .then((value) => catalogResult(state, request, value))
      .catch(() => null);
    if (next) {
      setState(next);
      setUncertain(mutation || (uncertain && !catalogRecovered(next)));
    } else {
      if (mutation) {
        setUncertain(true);
        setState({ ...state, installed: null, status: null, notice: null });
      }
      setError(
        mutation
          ? "Host outcome unknown. Refresh host status and installed agents before deciding whether to retry."
          : "Registry unavailable. Check host support for acp-registry-v1, host admin role and Sled permissions, then refresh.",
      );
    }
    lock.current = false;
    setBusy(false);
  };
  return { state, busy, error, uncertain, run };
}
