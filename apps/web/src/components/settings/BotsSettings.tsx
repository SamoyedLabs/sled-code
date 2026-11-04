import { botHostRecoveryDescription } from "@t3tools/client-runtime/openbot/presentation";
import { BotProviderChoice } from "./BotProviderChoice";
import { BotRuntimeControls } from "./BotRuntimeControls";
import { BotProviderSetup } from "./BotProviderSetup";
import { BotProviderSettings } from "./BotProviderSettings";
import { BotAttention } from "./BotAttention";
import { SledToolsConnection } from "./SledToolsConnection";
import { BotConfiguration } from "./BotConfiguration";
import { BotFiles } from "./BotFiles";
import { BotCodingPolicy } from "./BotCodingPolicy";
import { BotWorkflows } from "./BotWorkflows";
import { BotChannels } from "./BotChannels";
import { requestConfirmDialog } from "../../confirmDialog";
import { Link } from "@tanstack/react-router";
import { randomUUID } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import type { EnvironmentId, OpenbotAdminRequest, OpenbotWriteRequest } from "@t3tools/contracts";
import {
  botViewRequest,
  providerModels,
  providerStatus,
  validProviderChoice,
  botCreateRequest,
  EMPTY_BOT_PROVIDER_CHOICE,
  type BotProviderChoice as ProviderChoice,
  conversationView,
  memoryViews,
  routineViews,
  taskViews,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function BotsSettings() {
  const { connectedEnvironments } = useSettingsScope();
  return (
    <SettingsPageContainer>
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Give persistent bots ongoing responsibilities, then follow their work from any device.
        </p>
        {connectedEnvironments.length === 0 ? (
          <p>Connect an environment to manage its bots.</p>
        ) : (
          connectedEnvironments.map((environment) => (
            <BotEnvironment
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environment.label}
            />
          ))
        )}
      </div>
    </SettingsPageContainer>
  );
}

function BotEnvironment({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(
    host.data?.state === "ready" ? openbot.agents({ environmentId, input: {} }) : null,
  );
  const canManage = useAtomValue(openbot.start.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const start = useAtomCommand(openbot.start, { reportFailure: false });
  const stop = useAtomCommand(openbot.stop, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationHostId, setCreationHostId] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [choice, setChoice] = useState<ProviderChoice>(EMPTY_BOT_PROVIDER_CHOICE);
  const modelsQuery = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: host.data.hostId, request: { operation: "agent.models" } },
        })
      : null,
  );
  const statusQuery = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: host.data.hostId, request: { operation: "agent.status" } },
        })
      : null,
  );
  const models = providerModels(modelsQuery.data);
  const providers = providerStatus(statusQuery.data);
  const canCreate = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId: host.data?.hostId ?? "unavailable",
      request: {
        operation: "agent.create",
        input: { name: "permission check", description: "", initialMessage: "permission check" },
      },
    }),
  );
  const adminToHost = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [engineBusy, setEngineBusy] = useState<"start" | "stop" | null>(null);
  const engineEpoch = useRef(0);
  const act = async (operation: "start" | "stop") => {
    if (engineBusy === "stop" || (operation === "start" && engineBusy !== null)) return;
    const epoch = ++engineEpoch.current;
    setEngineBusy(operation);
    setError(null);
    const result = await (operation === "start" ? start : stop)({ environmentId, input: {} });
    if (engineEpoch.current === epoch) {
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      setEngineBusy(null);
    }
    host.refresh();
    agents.refresh();
  };
  const removeBot = async () => {
    if (!selected || !selectedHostId || busy) return;
    const confirmed =
      (await requestConfirmDialog("Delete this bot and its conversations?", {
        variant: "destructive",
      })) ?? window.confirm("Delete this bot and its conversations?");
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const result = await adminToHost({
      environmentId,
      input: { hostId: selectedHostId, request: { operation: "agent.delete", agentId: selected } },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      setSelected(null);
      agents.refresh();
    }
    setBusy(false);
  };
  const create = async () => {
    if (
      busy ||
      !creationHostId ||
      creationHostId !== host.data?.hostId ||
      !models ||
      !providers ||
      !validProviderChoice(models, providers, choice)
    )
      return;
    const request = botCreateRequest(name, instructions, choice);
    if (!request) return;
    setBusy(true);
    setError(null);
    const result = await adminToHost({ environmentId, input: { hostId: creationHostId, request } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      setCreating(false);
      setName("");
      setInstructions("");
      setChoice(EMPTY_BOT_PROVIDER_CHOICE);
      agents.refresh();
    }
    setBusy(false);
  };
  const state = host.data?.state;
  return (
    <SettingsSection title={label}>
      <div className="space-y-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="mr-auto text-sm text-muted-foreground">
            {host.isPending
              ? "Checking bot engine…"
              : state === "ready"
                ? "Bot engine online"
                : state === "disabled"
                  ? "Bot engine is not configured on this environment"
                  : state === "failed"
                    ? `Bot engine failed: ${host.data?.reason ?? "unknown"}`
                    : state === "starting"
                      ? "Bot engine is starting…"
                      : "Bot engine stopped"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              host.refresh();
              agents.refresh();
            }}
            disabled={busy}
          >
            Refresh
          </Button>
          {state && state !== "disabled" && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                !canManage ||
                busy ||
                engineBusy !== null ||
                state === "starting" ||
                host.data?.recovery?.state === "switching" ||
                (state === "ready" && host.data?.desiredRunning !== false)
              }
              onClick={() => void act("start")}
            >
              {engineBusy === "start"
                ? "Starting…"
                : state === "ready"
                  ? "Enable automatic startup"
                  : host.data?.desiredRunning
                    ? "Retry engine"
                    : "Start engine"}
            </Button>
          )}
          {state && (state !== "disabled" || host.data?.desiredRunning) && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage || busy || engineBusy === "stop"}
              onClick={() => void act("stop")}
            >
              {engineBusy === "stop" ? "Stopping…" : "Stop engine"}
            </Button>
          )}
        </div>
        {host.data && (
          <p className="text-sm text-muted-foreground">{botHostRecoveryDescription(host.data)}</p>
        )}
        {!canManage && state !== "disabled" && (
          <p className="text-xs text-muted-foreground">
            Settings permission is required to start or stop this engine.
          </p>
        )}
        {(error || host.error || agents.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? host.error ?? agents.error}
          </p>
        )}
        <BotRuntimeControls environmentId={environmentId} />
        {state === "ready" && <SledToolsConnection environmentId={environmentId} />}
        {state === "ready" && <BotAttention environmentId={environmentId} />}
        {state === "ready" && host.data?.hostId && (
          <BotProviderSetup
            key={host.data.hostId}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {state === "ready" && host.data?.hostId && (
          <BotWorkflows
            key={`workflows:${host.data.hostId}`}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {state === "ready" && host.data?.hostId && (
          <BotChannels
            key={`channels:${host.data.hostId}`}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {state === "ready" && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Bots</h3>
              <Button
                size="sm"
                variant="outline"
                disabled={!canCreate || busy || !host.data?.hostId}
                onClick={() => {
                  setCreating(!creating);
                  if (!creating) setCreationHostId(host.data?.hostId ?? null);
                }}
              >
                {creating ? "Cancel" : "Create bot"}
              </Button>
            </div>
            {creating && (
              <form
                className="space-y-3 rounded-lg border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <label className="block space-y-1 text-sm">
                  <span>Name</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Responsibility and instructions</span>
                  <Textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={2000}
                    required
                  />
                </label>
                <BotProviderChoice
                  value={choice}
                  onChange={setChoice}
                  models={models ?? []}
                  providers={providers ?? []}
                  disabled={busy || !canCreate || models === null || providers === null}
                />
                <p className="text-sm text-muted-foreground">
                  Creating a bot sends its first message using the selected model and the provider's
                  own sign-in. Other accounts can be assigned after creation.
                </p>
                {(modelsQuery.error ||
                  statusQuery.error ||
                  creationHostId !== host.data?.hostId) && (
                  <p role="alert" className="text-sm text-destructive">
                    {modelsQuery.error ??
                      statusQuery.error ??
                      "The bot engine changed. Reopen this form before creating a bot."}
                  </p>
                )}
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    modelsQuery.refresh();
                    statusQuery.refresh();
                  }}
                >
                  Refresh providers
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    !canCreate ||
                    !name.trim() ||
                    !instructions.trim() ||
                    !models ||
                    !providers ||
                    !validProviderChoice(models, providers, choice) ||
                    creationHostId !== host.data?.hostId
                  }
                >
                  Create bot
                </Button>
              </form>
            )}
            {agents.isPending && !agents.data ? (
              <p role="status">Loading bots…</p>
            ) : agents.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bots yet. Create one and give it a responsibility.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {agents.data?.map((bot) => (
                  <li key={bot.id}>
                    <Button
                      variant={selected === bot.id ? "secondary" : "outline"}
                      onClick={() => {
                        setSelected(bot.id);
                        setSelectedHostId(host.data?.hostId ?? null);
                      }}
                      aria-pressed={selected === bot.id}
                    >
                      {bot.name} · {bot.provider}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {selected && selectedHostId && agents.data?.some((bot) => bot.id === selected) && (
              <div className="space-y-3">
                <BotDetail
                  key={`${selectedHostId}:${selected}`}
                  environmentId={environmentId}
                  agentId={selected}
                  expectedHostId={selectedHostId}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canAdmin}
                  onClick={() => void removeBot()}
                >
                  Delete selected bot
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}

type BotTab = "conversation" | "task" | "memory" | "routine";
function BotDetail({
  environmentId,
  agentId,
  expectedHostId,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  expectedHostId: string;
}) {
  const pendingMessage = useRef<{ text: string; id: string } | null>(null);
  const messageIdFor = (value: string) => {
    if (pendingMessage.current?.text !== value)
      pendingMessage.current = { text: value, id: randomUUID() };
    return pendingMessage.current.id;
  };
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [tab, setTab] = useState<BotTab>("conversation");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    openbot.read({
      environmentId,
      input: botViewRequest(agentId, tab, selectedTask),
    }),
  );
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const coding = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.codingTasks({ environmentId, input: { hostId: host.data.hostId, agentId } })
      : null,
  );
  const canWrite = useAtomValue(openbot.write.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.write, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const send = async (input: OpenbotWriteRequest | OpenbotAdminRequest, privileged = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = privileged
      ? await admin({
          environmentId,
          input: { hostId: expectedHostId, request: input as OpenbotAdminRequest },
        })
      : await write({ environmentId, input: input as OpenbotWriteRequest });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      pendingMessage.current = null;
      setEditingMemory(null);
      setText("");
      query.refresh();
    }
    setBusy(false);
  };
  const conversation =
    tab === "conversation" || (tab === "task" && selectedTask !== null)
      ? conversationView(query.data)
      : null;
  const tasks = tab === "task" && selectedTask === null ? taskViews(query.data) : null;
  const memories = tab === "memory" ? memoryViews(query.data) : null;
  const routines = tab === "routine" ? routineViews(query.data) : null;
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="Bot workspace">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Bot views">
        {(["conversation", "task", "memory", "routine"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? "secondary" : "ghost"}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setSelectedTask(null);
              setEditingMemory(null);
              setText("");
              setError(null);
            }}
          >
            {value === "conversation"
              ? "Chat"
              : value === "task"
                ? "Tasks"
                : value === "memory"
                  ? "Memory"
                  : "Routines"}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={query.refresh}>
          Refresh
        </Button>
      </div>
      {(error || query.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error}
        </p>
      )}
      {query.isPending && !query.data && <p role="status">Loading…</p>}
      {selectedTask && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelectedTask(null);
            setText("");
          }}
        >
          Back to tasks
        </Button>
      )}
      {conversation?.messages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No messages yet. Give this bot its first assignment.
        </p>
      )}
      {tasks?.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks yet. Start one below.</p>
      )}
      {memories?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No saved memories. Add something this bot should remember.
        </p>
      )}
      {routines?.length === 0 && (
        <p className="text-sm text-muted-foreground">No routines yet. Create one below.</p>
      )}
      {conversation && (
        <>
          <ol className="max-h-96 space-y-3 overflow-y-auto">
            {conversation.messages.map((message) => (
              <li key={message.id} className="space-y-1">
                <p className="text-xs capitalize text-muted-foreground">
                  {message.author} · {message.status}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
              </li>
            ))}
          </ol>
          {conversation.activeTurnId && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canWrite}
              onClick={() =>
                void send(
                  selectedTask
                    ? { operation: "task.stop", agentId, taskId: selectedTask }
                    : {
                        operation: "conversation.stop",
                        agentId,
                        turnId: conversation.activeTurnId!,
                      },
                )
              }
            >
              Stop current turn
            </Button>
          )}
        </>
      )}
      {tasks && (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.id} className="space-y-2">
              <p className="text-sm">
                {task.title}{" "}
                <span className="text-muted-foreground">
                  · {task.state}
                  {task.outcome ? ` · ${task.outcome}` : ""}
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedTask(task.id);
                    setText("");
                  }}
                >
                  Open task
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void send({
                      operation: task.state === "closed" ? "task.reopen" : "task.close",
                      agentId,
                      taskId: task.id,
                    })
                  }
                >
                  {task.state === "closed" ? "Reopen" : "Close task"}
                </Button>
                {task.state === "running" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !canWrite}
                    onClick={() => void send({ operation: "task.stop", agentId, taskId: task.id })}
                  >
                    Stop
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {memories && (
        <ul className="space-y-3">
          {memories.map((memory) => (
            <li key={memory.id} className="flex items-start gap-3">
              <p className="flex-1 whitespace-pre-wrap break-words text-sm">{memory.text}</p>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !canAdmin}
                onClick={() => {
                  setEditingMemory(memory.id);
                  setText(memory.text);
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !canAdmin}
                onClick={() =>
                  void send({ operation: "memory.delete", agentId, memoryId: memory.id }, true)
                }
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      {routines && (
        <ul className="space-y-3">
          {routines.map((routine) => (
            <li key={routine.id} className="space-y-2">
              <p className="text-sm font-medium">
                {routine.name} · {routine.active ? "Active" : "Paused"}
              </p>
              <p className="text-sm text-muted-foreground">{routine.instruction}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canAdmin}
                  onClick={() =>
                    void send(
                      {
                        operation: "routine.update",
                        agentId,
                        routineId: routine.id,
                        input: { active: !routine.active },
                      },
                      true,
                    )
                  }
                >
                  {routine.active ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void send({ operation: "routine.test", agentId, routineId: routine.id })
                  }
                >
                  Run now
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.data !== null &&
        query.data !== undefined &&
        !conversation &&
        !tasks &&
        !memories &&
        !routines && (
          <p role="alert" className="text-sm text-muted-foreground">
            This host returned an unsupported format. Update the integration before editing this
            view.
          </p>
        )}
      <BotProviderSettings
        environmentId={environmentId}
        agentId={agentId}
        hostId={expectedHostId}
      />
      <BotConfiguration environmentId={environmentId} agentId={agentId} hostId={expectedHostId} />
      <BotCodingPolicy
        key={`policy:${expectedHostId}:${agentId}`}
        environmentId={environmentId}
        hostId={expectedHostId}
        agentId={agentId}
      />
      <BotFiles
        key={`${expectedHostId}:${agentId}`}
        environmentId={environmentId}
        hostId={expectedHostId}
        agentId={agentId}
      />
      <section className="space-y-2" aria-label="Delegated coding work">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Coding work</h4>
          <Button size="sm" variant="ghost" onClick={coding.refresh}>
            Refresh coding work
          </Button>
        </div>
        {coding.error && (
          <p role="alert" className="text-sm text-destructive">
            {coding.error}
          </p>
        )}
        {coding.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Coding assignments delegated by this bot will appear here.
          </p>
        )}
        <ul className="space-y-2">
          {coding.data?.map((task) => (
            <li key={`${task.origin.taskId}:${task.operationId}`} className="space-y-1">
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: task.threadId }}
                className="text-sm text-primary underline underline-offset-4"
              >
                Open coding thread · {task.state}
              </Link>
              {task.result && (
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {task.result}
                </p>
              )}
              {task.delivery?.state === "pending" && (
                <p className="text-sm text-muted-foreground">
                  Result delivery to the bot is pending.
                </p>
              )}
              {task.delivery?.state === "reconciliation-required" && (
                <p role="status" className="text-sm text-muted-foreground">
                  The bot’s receipt needs review before this result can be sent again.
                </p>
              )}
              {task.pendingRequestIds.length > 0 && (
                <p className="text-sm">This thread needs your input.</p>
              )}
            </li>
          ))}
        </ul>
      </section>
      {tab === "routine" && routines !== null && (
        <DailyRoutineForm
          environmentId={environmentId}
          agentId={agentId}
          hostId={expectedHostId}
          onCreated={query.refresh}
        />
      )}
      {tab !== "routine" && (conversation !== null || tasks !== null || memories !== null) && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            const clientMessageId = messageIdFor(`${tab}:${selectedTask ?? "main"}:${text.trim()}`);
            void send(
              tab === "memory"
                ? editingMemory
                  ? {
                      operation: "memory.update",
                      agentId,
                      memoryId: editingMemory,
                      text: text.trim(),
                    }
                  : { operation: "memory.create", agentId, text: text.trim() }
                : tab === "task" && selectedTask
                  ? {
                      operation: "task.send",
                      agentId,
                      taskId: selectedTask,
                      text: text.trim(),
                      clientMessageId,
                    }
                  : {
                      operation: tab === "task" ? "task.start" : "conversation.send",
                      agentId,
                      text: text.trim(),
                      clientMessageId,
                    },
              tab === "memory",
            );
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>
              {tab === "conversation"
                ? "Message"
                : tab === "task"
                  ? selectedTask
                    ? "Message task"
                    : "New task"
                  : editingMemory
                    ? "Edit memory"
                    : "Remember"}
            </span>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={tab === "memory" ? 500 : 100000}
              required
            />
          </label>
          <Button
            size="sm"
            type="submit"
            disabled={busy || !text.trim() || (tab === "memory" ? !canAdmin : !canWrite)}
          >
            {busy
              ? "Sending…"
              : tab === "conversation"
                ? "Send"
                : tab === "task"
                  ? selectedTask
                    ? "Send"
                    : "Start task"
                  : editingMemory
                    ? "Save memory"
                    : "Add memory"}
          </Button>
        </form>
      )}
    </section>
  );
}

function DailyRoutineForm({
  environmentId,
  agentId,
  hostId,
  onCreated,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  hostId: string;
  onCreated: () => void;
}) {
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [time, setTime] = useState("09:00");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (busy || !name.trim() || !instruction.trim() || !timezone.trim()) return;
    setBusy(true);
    setError(null);
    const result = await admin({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "routine.create",
          agentId,
          input: {
            name: name.trim(),
            instruction: instruction.trim(),
            active: true,
            timezone: timezone.trim(),
            schedule: { kind: "daily", time },
          },
        },
      },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      setName("");
      setInstruction("");
      onCreated();
    }
    setBusy(false);
  };
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <h4 className="text-sm font-medium">Create daily routine</h4>
      <label className="block space-y-1 text-sm">
        <span>Name</span>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Instructions</span>
        <Textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={100000}
          required
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span>Time</span>
          <Input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Time zone</span>
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            maxLength={512}
            required
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        size="sm"
        type="submit"
        disabled={busy || !canAdmin || !name.trim() || !instruction.trim() || !timezone.trim()}
      >
        {busy ? "Creating…" : "Create routine"}
      </Button>
    </form>
  );
}
