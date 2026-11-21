import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  sharedTables,
  hostedSites,
  dataFailure,
} from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { DataActions, DataRequest } from "@t3tools/client-runtime/openbot/presentation";

export function useBotData(actions: DataActions) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ tables: string | null; sites: string | null }>({
    tables: null,
    sites: null,
  });
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
    const isTable = request.operation.startsWith("tables.");
    const resource = isTable ? "tables" : "sites";
    setErrors((current) => ({ ...current, [resource]: null }));
    const settled = await settlePromise(async () => {
      const response = await actions.execute(request);
      const failure = dataFailure(response);
      if (failure) throw new Error(failure);
      if (request.operation.endsWith("delete")) setPending(null);
      const value = request.operation.endsWith("delete")
        ? await actions.execute({ operation: isTable ? "tables.list" : "sites.list" })
        : response;
      const refreshFailure = dataFailure(value);
      if (refreshFailure) throw new Error(refreshFailure);
      if (isTable) {
        const next = sharedTables(value);
        if (next === null) throw new Error("The host returned an unreadable table list.");
        setTables(next);
      } else {
        const next = hostedSites(value);
        if (next === null) throw new Error("The host returned an unreadable site list.");
        setSites(next);
      }
    });
    lock.current = false;
    setBusy(false);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      const message =
        cause instanceof Error ? cause.message : "Could not load host data. Try refreshing.";
      setErrors((current) => ({ ...current, [resource]: message }));
      return message;
    }
  };
  const load = useEffectEvent(async () => {
    await run({ operation: "tables.list" });
    await run({ operation: "sites.list" });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch the host inventory when access becomes available; each resource retains its own loaded state.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Begin the remote inventory request when permissions change.
    if (actions.canReadTables || actions.canReadSites) void load();
  }, [actions.canReadTables, actions.canReadSites]);
  return {
    tables,
    sites,
    errors,
    busy,
    pending,
    setPending,
    refreshTables: () => void run({ operation: "tables.list" }),
    refreshSites: () => void run({ operation: "sites.list" }),
    openFailed: () =>
      setErrors((current) => ({ ...current, sites: "The device could not open this site link." })),
    confirmDelete: () => {
      if (pending) void run(pending);
    },
  };
}
