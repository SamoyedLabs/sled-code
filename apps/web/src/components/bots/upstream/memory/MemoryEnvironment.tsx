import * as Option from "effect/Option";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { toastManager } from "../../../ui/toast";
import { t } from "../data/source-text";
import { AgentMemoriesView } from "./AgentMemoriesView";
import {
  readMemories,
  readSelectionPage,
  type MemoryEntry,
  type MemorySelection,
} from "./memory-model";
export function MemoryEnvironment(props: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  agentName: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <MemoryHost
      key={`${props.environmentId}:${props.hostId}:${props.agentId}:${session.epoch}`}
      {...props}
      connection={connection}
    />
  );
}
function MemoryHost({
  environmentId,
  hostId,
  agentId,
  agentName,
  onBack,
  onClose,
  connection,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  agentName: string;
  onBack: () => void;
  onClose: () => void;
  connection: ReturnType<typeof readPreparedConnection>;
}) {
  const registry = useContext(RegistryContext);
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "memory.list", agentId } },
    }),
  );
  const reload = useAtomQueryRunner(openbot.readFromHost, { refresh: true, reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const canEdit = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "memory.create", agentId, text: "permission-check" },
    }),
  );
  const selectionRequest = {
    operation: "settings.agent-memories.selection" as const,
    parameters: { agentId, after: null },
  };
  const canReadSelection = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, { hostId, request: selectionRequest }),
  );
  const canSetInclusion = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.agent-memories.inclusion",
        parameters: { agentId, changes: [] },
      },
    }),
  );
  const [selection, setSelection] = useState<{
    connection: typeof connection;
    value: MemorySelection;
  } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [savingId, setSavingId] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [clearConfirmation, setClearConfirmation] = useState(false);
  const lock = useRef(false),
    lifetime = useRef(0),
    pendingDeletes = useRef(new Map<string, { commit: () => void; settle: () => boolean }>());
  const run = async (request: OpenbotAdminRequest) => {
    if (!connection || readPreparedConnection(environmentId) !== connection)
      throw new Error("Reconnect the original host session.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You don’t have permission to change these memories.");
    const result = await admin({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (readPreparedConnection(environmentId) !== connection)
      throw new Error("The original host session changed.");
  };
  const refreshSelection = async () => {
    if (!canReadSelection || !connection) return;
    const expected = connection,
      generation = lifetime.current;
    let after: string | null = null;
    const seen = new Set<string>(),
      entries: MemorySelection["selections"][number][] = [];
    do {
      const request = {
        operation: "settings.agent-memories.selection" as const,
        parameters: { agentId, after },
      };
      if (!registry.get(openbot.settingsRead.permissionAtom(environmentId, { hostId, request })))
        return;
      const result = await read({ environmentId, input: { hostId, request } });
      if (generation !== lifetime.current || readPreparedConnection(environmentId) !== expected)
        return;
      if (result._tag === "Failure") return;
      try {
        const page = readSelectionPage(result.value);
        if (page.agentId !== agentId) return;
        entries.push(...page.selections);
        after = page.nextCursor;
        if (after && seen.has(after)) return;
        if (after) seen.add(after);
        if (!after) setSelection({ connection: expected, value: { ...page, selections: entries } });
      } catch {
        return;
      }
    } while (after);
  };
  const loadSelection = useEffectEvent(refreshSelection);
  /* oxlint-disable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies -- Async selection reads are invalidated by connection, permission and underlying memory changes. */
  useEffect(() => {
    void loadSelection();
    return () => {
      lifetime.current += 1;
    };
  }, [connection, canReadSelection, query.dataUpdatedAt]);
  /* oxlint-enable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies */
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source commits pending undo deletions on close; each closure retains and verifies its original session.
  useEffect(
    () => () => {
      for (const deletion of pendingDeletes.current.values()) deletion.commit();
    },
    [],
  );
  let memories: readonly MemoryEntry[] = [];
  let decodeError: string | null = null;
  if (query.data !== null) {
    try {
      memories = readMemories(query.data);
    } catch {
      decodeError = t("memory.loadFailed");
    }
  }
  const displayed = memories.filter((memory) => !hidden.has(memory.id));
  const selected =
    canReadSelection && selection?.connection === connection ? selection.value : null;
  const save = async (id: string, request: OpenbotAdminRequest) => {
    if (lock.current) return false;
    lock.current = true;
    setSavingId(id);
    setError(null);
    try {
      await run(request);
      const updated = await reload({
        environmentId,
        input: { hostId, request: { operation: "memory.list", agentId } },
      });
      if (updated._tag === "Failure") throw squashAtomCommandFailure(updated);
      await refreshSelection();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("memory.saveFailed"));
      return false;
    } finally {
      lock.current = false;
      setSavingId(null);
    }
  };
  const hide = (id: string, value: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  const deleteMemory = (memory: MemoryEntry) => {
    if (pendingDeletes.current.has(memory.id)) return;
    const toastId = `memory-delete-${environmentId}-${hostId}-${agentId}-${memory.id}`;
    setError(null);
    hide(memory.id, true);
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      pendingDeletes.current.delete(memory.id);
      queueMicrotask(() => toastManager.close(toastId));
      return true;
    };
    const commit = async () => {
      if (!settle()) return;
      try {
        await run({ operation: "memory.delete", agentId, memoryId: memory.id });
        query.refresh();
      } catch (cause) {
        hide(memory.id, false);
        const message = cause instanceof Error ? cause.message : t("memory.deleteFailed");
        setError(message);
        toastManager.add({ type: "error", title: message });
      }
    };
    pendingDeletes.current.set(memory.id, { commit: () => void commit(), settle });
    toastManager.add({
      id: toastId,
      title: t("memory.deleteUndo.title"),
      timeout: 8000,
      actionProps: {
        children: t("memory.deleteUndo.action"),
        onClick: () => {
          if (settle()) hide(memory.id, false);
        },
      },
      onClose: () => void commit(),
    });
  };
  const setInclusion = (
    memory: MemoryEntry,
    inclusion: "essential" | "searchable" | "automatic",
  ) => {
    const entry = selected?.selections.find((entry) => entry.memoryId === memory.id);
    if (!entry) return;
    void save(memory.id, {
      operation: "settings.agent-memories.inclusion",
      parameters: {
        agentId,
        changes: [{ memoryId: memory.id, inclusion, expectedRevision: entry.revision }],
      },
    }).then(() => {
      void refreshSelection();
    });
  };
  return (
    <>
      <AgentMemoriesView
        ownerNoun="agent"
        ownerLabel={agentName}
        memories={displayed}
        inclusion={
          selected
            ? new Map(selected.selections.map((entry) => [entry.memoryId, entry.inclusion]))
            : undefined
        }
        userControlled={
          selected
            ? new Set(
                selected.selections
                  .filter((entry) => entry.userControlled)
                  .map((entry) => entry.memoryId),
              )
            : undefined
        }
        loading={query.isPending && query.data === null}
        error={error ?? query.error ?? decodeError}
        reachedLimit={null}
        savingId={savingId}
        canEdit={canEdit}
        canSetInclusion={canSetInclusion}
        onBack={onBack}
        onClose={onClose}
        onCreate={(text) => save("new", { operation: "memory.create", agentId, text })}
        onUpdate={(memory, text) =>
          save(memory.id, { operation: "memory.update", agentId, memoryId: memory.id, text })
        }
        onDelete={deleteMemory}
        onSetEveryChat={(memory, value) => setInclusion(memory, value ? "essential" : "searchable")}
        onLetAgentDecide={(memory) => setInclusion(memory, "automatic")}
        onClearAll={() => setClearConfirmation(true)}
      />
      <SourceConfirmDialog
        open={clearConfirmation}
        title={t("memory.clearTitle")}
        description={t("memory.clearDescription", { total: displayed.length, name: agentName })}
        confirmLabel={t("memory.clearAll")}
        pending={savingId === "clear"}
        error={error}
        onCancel={() => setClearConfirmation(false)}
        onConfirm={async () => {
          if (await save("clear", { operation: "memory.clear", agentId })) {
            for (const deletion of pendingDeletes.current.values()) deletion.settle();
            setClearConfirmation(false);
          }
        }}
      />
    </>
  );
}
