import { useRef, useState } from "react";
import {
  sharedTables,
  hostedSites,
  dataFailure,
} from "@t3tools/client-runtime/openbot/presentation";
import type { DataActions, DataRequest } from "@t3tools/client-runtime/openbot/presentation";
export function useBotData(actions: DataActions) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<ReturnType<typeof sharedTables>>(null);
  const [sites, setSites] = useState<ReturnType<typeof hostedSites>>(null);
  const [pending, setPending] = useState<Extract<
    DataRequest,
    { operation: "tables.delete" | "sites.delete" }
  > | null>(null);
  const run = async (request: DataRequest) => {
    if (
      lock.current ||
      (request.operation === "tables.list" && !actions.canReadTables) ||
      (request.operation === "sites.list" && !actions.canReadSites) ||
      ((request.operation === "tables.delete" || request.operation === "sites.delete") &&
        !actions.canDelete(request))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setPending(null);
    const isTable = request.operation.startsWith("tables.");
    if (isTable) setTables(null);
    else setSites(null);
    await (async () => {
      const response = await actions.execute(request);
      const failure = dataFailure(response);
      if (failure) {
        setError(failure);
        return;
      }
      const value = request.operation.endsWith("delete")
        ? await actions.execute({ operation: isTable ? "tables.list" : "sites.list" })
        : response;
      const refreshFailure = dataFailure(value);
      if (refreshFailure) {
        setError(refreshFailure);
        return;
      }
      if (isTable) {
        const next = sharedTables(value);
        if (next === null) throw new Error("Invalid tables");
        setTables(next);
      } else {
        const next = hostedSites(value);
        if (next === null) throw new Error("Invalid sites");
        setSites(next);
      }
    })().catch(() =>
      setError(
        "The data request failed or returned unsupported data. Check host support, account and permissions; refresh before retrying.",
      ),
    );
    lock.current = false;
    setBusy(false);
  };
  return {
    tables,
    sites,
    error,
    busy,
    pending,
    setPending,
    refreshTables: () => void run({ operation: "tables.list" }),
    refreshSites: () => void run({ operation: "sites.list" }),
    openFailed: () => setError("The device could not open this site link."),
    confirmDelete: () => {
      if (pending) void run(pending);
    },
  };
}
