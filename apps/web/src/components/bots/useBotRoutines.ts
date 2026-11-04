import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotEventAdminRequest,
  OpenbotRoutineFlowCommand,
} from "@t3tools/contracts";
import {
  EVENT_SCHEDULE_TEMPLATE,
  EVENT_ROUTINE_TEMPLATE,
  channelList,
  workflowAgents,
  routineFlowCanvas,
  routineRows,
  eventRoutineDraft,
  eventRoutineRequest,
} from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

type RoutineRequest = Extract<OpenbotEventAdminRequest, { operation: "events.save" }>;
type Owner = { kind: "agent" | "channel"; id: string };
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function useBotRoutineDiscovery(environmentId: EnvironmentId, hostId: string) {
  const agents = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const channels = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.list" } },
    }),
  );
  return {
    agents: workflowAgents(agents.data),
    channels: (channelList(channels.data) ?? []).filter((channel) => !channel.archived),
    error: agents.error ?? channels.error,
    refresh: () => {
      agents.refresh();
      channels.refresh();
    },
  };
}
export function useBotEvents(environmentId: EnvironmentId, hostId: string) {
  const discovery = useBotRoutineDiscovery(environmentId, hostId);
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "events.status" },
    }),
  );
  const canRun = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "events.test",
        owner: { kind: "agent", id: "permission" },
        id: "permission",
      },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [owner, setOwner] = useState<Owner>({ kind: "agent", id: "" });
  const [routineId, setRoutineId] = useState("");
  const [rows, setRows] = useState<readonly Record<string, unknown>[]>([]);
  const [draft, setDraft] = useState(EVENT_SCHEDULE_TEMPLATE);
  const [form, setForm] = useState<RoutineRequest>(() =>
    eventRoutineRequest(EVENT_SCHEDULE_TEMPLATE, { kind: "agent", id: "draft" })!,
  );
  const [service, setService] = useState<{ supported: boolean; connected: boolean } | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [resultKind, setResultKind] = useState<OpenbotEventAdminRequest["operation"] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [configuration, setConfiguration] = useState<{
    owner: Owner;
    routineId: string;
    name: string;
    value: unknown;
  } | null>(null);
  const lock = useRef(false);
  const owners =
    owner.kind === "agent"
      ? discovery.agents.map((agent) => ({ id: agent.id, name: agent.name }))
      : discovery.channels.map((channel) => ({
          id: channel.id,
          name: channel.title || channel.name,
        }));
  const ownerName = owners.find((option) => option.id === owner.id)?.name;
  const ownerAvailable = Boolean(ownerName);
  const candidate = !readOnly ? eventRoutineRequest(draft, owner) : null;
  const request =
    candidate && (routineId ? candidate.id === routineId : !candidate.id) ? candidate : null;
  function dismissConfiguration() {
    setConfiguration(null);
    setRevealed(false);
  }
  function resetEditor() {
    setRoutineId("");
    setDraft(EVENT_SCHEDULE_TEMPLATE);
    setForm(eventRoutineRequest(EVENT_SCHEDULE_TEMPLATE, { kind: "agent", id: "draft" })!);
    setReadOnly(false);
    setResult(null);
    setResultKind(null);
    setError(null);
    dismissConfiguration();
  }
  function selectOwner(kind: Owner["kind"], id: string) {
    if (lock.current) return;
    setOwner({ kind, id });
    setRows([]);
    resetEditor();
  }
  function selectRoutine(id: string) {
    if (lock.current) return;
    dismissConfiguration();
    setResult(null);
    setResultKind(null);
    setError(null);
    setRoutineId(id);
    const row = rows.find((entry) => entry.id === id);
    if (!row) {
      setDraft(EVENT_SCHEDULE_TEMPLATE);
      setForm(eventRoutineRequest(EVENT_SCHEDULE_TEMPLATE, { kind: "agent", id: "draft" })!);
      setReadOnly(false);
      return;
    }
    const next = eventRoutineDraft(row);
    setDraft(next ?? JSON.stringify(row, null, 2));
    if (next) setForm(eventRoutineRequest(next, owner)!);
    setReadOnly(next === null);
  }
  function newRoutine(kind: "schedule" | "webhook") {
    if (lock.current) return;
    resetEditor();
    const text = kind === "schedule" ? EVENT_SCHEDULE_TEMPLATE : EVENT_ROUTINE_TEMPLATE;
    setDraft(text);
    setForm(eventRoutineRequest(text, { kind: "agent", id: "draft" })!);
  }
  function updateDraft(next: string) {
    if (!lock.current && !readOnly) {
      setDraft(next);
      const parsed = eventRoutineRequest(next, { ...owner, id: owner.id || "draft" });
      if (parsed) setForm(parsed);
      dismissConfiguration();
    }
  }
  function patch(fields: Partial<Omit<RoutineRequest, "owner" | "operation">>) {
    if (lock.current || readOnly) return;
    let source: Record<string, unknown> | null = null;
    try {
      source = record(JSON.parse(draft));
    } catch {
      return;
    }
    setForm((current) => ({ ...current, ...fields }));
    if (source) updateDraft(JSON.stringify({ ...source, ...fields }, null, 2));
  }
  const act = async (input: OpenbotEventAdminRequest) => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    dismissConfiguration();
    const settled = await settlePromise(async () => {
      const response = await admin({ environmentId, input: { hostId, request: input } });
      if (response._tag === "Failure") {
        if (input.operation === "events.save" && !input.id) setReadOnly(true);
        setError("The request could not complete. Reload before retrying a creation or test.");
        return null;
      }
      const value = response.value;
      if (input.operation === "events.status") {
        const status = record(value);
        if (typeof status?.supported === "boolean" && typeof status.connected === "boolean")
          setService({ supported: status.supported, connected: status.connected });
      }
      if (input.operation === "events.list") setRows(routineRows(value));
      if (input.operation === "events.save") {
        const saved = record(record(value)?.routine);
        const savedOwner = record(saved?.owner);
        if (
          !saved ||
          typeof saved.id !== "string" ||
          savedOwner?.kind !== input.owner.kind ||
          savedOwner.id !== input.owner.id
        ) {
          setError(
            "The saved routine could not be identified. Reload routines before saving again.",
          );
          setReadOnly(true);
          return null;
        }
        const publicSaved = record(
          JSON.parse(
            JSON.stringify(saved, (key, entry: unknown) =>
              ["url", "webhookUrl", "secret"].includes(key) ? null : entry,
            ),
          ),
        )!;
        const next = eventRoutineDraft(publicSaved);
        setRoutineId(saved.id);
        setDraft(next ?? JSON.stringify(publicSaved, null, 2));
        if (next) setForm(eventRoutineRequest(next, input.owner)!);
        setReadOnly(next === null);
        setRows((current) => [...current.filter((row) => row.id !== saved.id), publicSaved]);
        if (record(value)?.secret)
          setConfiguration({
            owner: input.owner,
            routineId: saved.id,
            name: String(saved.name || "Untitled routine"),
            value,
          });
        setResult(null);
        setResultKind(null);
      } else if (input.operation === "events.rotateSecret") {
        setConfiguration({
          owner: input.owner,
          routineId: input.id,
          name: String(rows.find((row) => row.id === input.id)?.name || "Selected routine"),
          value,
        });
        setResult(null);
        setResultKind(null);
      } else if (input.operation === "events.delete") {
        setRows((current) => current.filter((row) => row.id !== input.id));
        resetEditor();
      } else if (input.operation !== "events.list") {
        setResult(value);
        setResultKind(input.operation);
      }
      return value;
    });
    lock.current = false;
    setBusy(false);
    if (settled._tag === "Failure") {
      if (input.operation === "events.save" && !input.id) setReadOnly(true);
      setError("The outcome is uncertain. Reload before retrying a creation or test.");
      return null;
    }
    return settled.value;
  };
  return {
    ...discovery,
    owner,
    ownerName,
    ownerAvailable,
    owners,
    selectOwner,
    routineId,
    rows,
    selectRoutine,
    newRoutine,
    draft,
    updateDraft,
    patch,
    readOnly,
    request,
    form,
    service,
    canAdmin,
    canRun,
    busy,
    error: error ?? discovery.error,
    result,
    resultKind,
    configuration,
    revealed,
    setRevealed,
    dismissConfiguration,
    act,
  };
}
export function useBotRoutineFlows(environmentId: EnvironmentId, hostId: string, agentId: string) {
  const query = useEnvironmentQuery(
    agentId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "routineFlow.canvas", agentId } },
        })
      : null,
  );
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const act = async (request: OpenbotRoutineFlowCommand) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const response = await write({ environmentId, input: { hostId, request } });
      if (response._tag === "Failure")
        setError("The flow change was refused. Check your permissions for every bot in this flow.");
      query.refresh();
    });
    if (settled._tag === "Failure")
      setError("The flow change could not complete. Reload before retrying.");
    lock.current = false;
    setBusy(false);
  };
  return {
    canvas: routineFlowCanvas(query.data),
    error: error ?? query.error,
    refresh: query.refresh,
    busy,
    canWrite,
    act,
  };
}
