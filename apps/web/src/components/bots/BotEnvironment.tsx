import { BotImportEnvironment } from "../settings/BotImportEnvironment";
import { BotSettingsEnvironment } from "../settings/BotSettingsEnvironment";
import { BotRoutineNotification } from "./BotRoutineNotification";
import { DataEnvironment } from "../settings/DataEnvironment";
import { BotEvents } from "./BotEvents";
import { BotRoutineFlows } from "./BotRoutineFlows";
import { BotConversationPanel } from "../settings/BotConversationPanel";
import { botHostRecoveryDescription } from "@t3tools/client-runtime/openbot/presentation";
import { BotProviderChoice } from "../settings/BotProviderChoice";
import { BotRuntimeControls } from "../settings/BotRuntimeControls";
import { OpenbotMaintenance } from "../settings/OpenbotMaintenance";
import { BotProviderSetup } from "../settings/BotProviderSetup";
import { BotProviderSettings } from "../settings/BotProviderSettings";
import { BotAttention } from "../settings/BotAttention";
import { SledToolsConnection } from "../settings/SledToolsConnection";
import { BotConfiguration } from "../settings/BotConfiguration";
import { BotFiles } from "../settings/BotFiles";
import { ComputerEnvironment } from "../settings/ComputerEnvironment";
import { BotBrowser } from "../settings/BotBrowser";
import { BotCodingPolicy } from "../settings/BotCodingPolicy";
import { BotWorkflows } from "../settings/BotWorkflows";
import { BotChannels } from "../settings/BotChannels";
import { BotChannelExtras } from "../settings/BotChannelExtras";
import { requestConfirmDialog } from "../../confirmDialog";
import { Link } from "@tanstack/react-router";
import { randomUUID, cn } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { BotIcon, BrainIcon, CalendarClockIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { EnvironmentId, OpenbotAdminRequest, OpenbotWriteRequest } from "@t3tools/contracts";
import {
  botViewRequest,
  providerModels,
  providerStatus,
  validProviderChoice,
  botCreateRequest,
  EMPTY_BOT_PROVIDER_CHOICE,
  type BotProviderChoice as ProviderChoice,
  memoryViews,
  routineViews,
  taskViews,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function BotEnvironment({
  environmentId,
  label,
  workspace = false,
  createOnHost,
  onCreated,
}: {
  environmentId: EnvironmentId;
  label: string;
  workspace?: boolean;
  createOnHost?: string;
  onCreated?: () => void;
}) {
  const [view, setView] = useState("bots");
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
  const [creating, setCreating] = useState(Boolean(createOnHost));
  const [creationHostId, setCreationHostId] = useState<string | null>(createOnHost ?? null);
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
      onCreated?.();
    }
    setBusy(false);
  };
  const state = host.data?.state;
  const creationForm = (
    <form
      className="space-y-5 rounded-2xl bg-muted/25 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Name</span>
        <Input
          placeholder="Give your bot a name"
          disabled={busy || !canCreate}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">What should this bot do?</span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Describe its role, responsibilities, and how you want it to work.
        </p>
        <Textarea
          placeholder="You help me keep track of…"
          rows={5}
          disabled={busy || !canCreate}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          maxLength={2000}
          required
        />
      </label>
      <div className="space-y-3 border-t border-border/60 pt-5">
        <h3 className="text-sm font-medium">Choose a model</h3>
        <BotProviderChoice
          value={choice}
          onChange={setChoice}
          models={models ?? []}
          providers={providers ?? []}
          disabled={busy || !canCreate || models === null || providers === null}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Creating a bot sends its first message using the selected model and the provider's own
        sign-in. Other accounts can be assigned after creation.
      </p>
      {(host.isPending || modelsQuery.isPending || statusQuery.isPending) && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading available providers and models…
        </p>
      )}
      {(modelsQuery.error ||
        statusQuery.error ||
        (host.data && creationHostId !== host.data.hostId)) && (
        <p role="alert" className="text-sm text-destructive">
          {modelsQuery.error ??
            statusQuery.error ??
            "The bot engine changed. Reopen this form before creating a bot."}
        </p>
      )}
      {!canCreate && (
        <p className="text-sm text-muted-foreground">
          Host settings permission is required to create a bot.
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <Button
          variant="ghost"
          size="sm"
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
          {busy ? "Creating…" : "Create bot"}
        </Button>
      </div>
    </form>
  );
  if (createOnHost)
    return (
      <div className="mx-auto w-full max-w-xl space-y-6">
        <header className="space-y-2">
          <BotIcon aria-hidden className="mb-4 size-7 text-muted-foreground" />
          <h2 className="text-balance text-2xl font-semibold">Create a bot</h2>
          <p className="text-pretty text-sm text-muted-foreground">
            Give it a role and a model. You can fine-tune its tools and settings after creation.
          </p>
        </header>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {creationForm}
      </div>
    );
  return (
    <SettingsSection title={label}>
      <div className="space-y-4 py-2">
        {!workspace && (
          <p className="text-sm text-muted-foreground">
            Bot hosting on {label}. Enabling it runs bots on this computer and remembers your choice
            when its Sled service restarts. Disabling it stops bot hosting; coding and remote
            desktop streaming keep their own settings.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="mr-auto text-sm text-muted-foreground">
            {host.isPending
              ? "Checking bot hosting…"
              : state === "ready"
                ? "Bot hosting is running"
                : state === "disabled"
                  ? "Bot hosting is not installed on this computer"
                  : state === "failed"
                    ? `Bot hosting failed: ${host.data?.reason ?? "unknown"}`
                    : state === "starting"
                      ? "Bot hosting is starting…"
                      : "Bot hosting is stopped"}
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
          {!workspace && state && state !== "disabled" && (
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
                  ? "Keep bot hosting enabled"
                  : host.data?.desiredRunning
                    ? "Retry bot hosting"
                    : "Enable bot hosting"}
            </Button>
          )}
          {!workspace && state && (state !== "disabled" || host.data?.desiredRunning) && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage || busy || engineBusy === "stop"}
              onClick={() => void act("stop")}
            >
              {engineBusy === "stop" ? "Stopping…" : "Disable bot hosting"}
            </Button>
          )}
        </div>
        {host.data && (
          <p className="text-sm text-muted-foreground">{botHostRecoveryDescription(host.data)}</p>
        )}
        {!canManage && state !== "disabled" && (
          <p className="text-xs text-muted-foreground">
            Settings permission is required to enable or disable bot hosting on this computer.
          </p>
        )}
        {(error || host.error || agents.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? host.error ?? agents.error}
          </p>
        )}
        {!workspace && (
          <>
            <BotRuntimeControls environmentId={environmentId} />
            {state === "ready" && host.data?.hostId && (
              <BotImportEnvironment
                key={`${environmentId}:${host.data.hostId}`}
                environmentId={environmentId}
                hostId={host.data.hostId}
                destination={label}
              />
            )}
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-medium">Upstream maintenance</summary>
              <OpenbotMaintenance environmentId={environmentId} />
            </details>
            {state === "ready" && <SledToolsConnection environmentId={environmentId} />}
            {state === "ready" && host.data?.hostId && (
              <BotProviderSetup
                key={host.data.hostId}
                environmentId={environmentId}
                hostId={host.data.hostId}
              />
            )}
          </>
        )}
        {workspace && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Workspace views">
            {["bots", "approvals", "channels", "workflows"].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={view === value ? "secondary" : "ghost"}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {value === "bots"
                  ? "Bots"
                  : value === "approvals"
                    ? "Needs attention"
                    : value === "channels"
                      ? "Channels"
                      : "Workflows"}
              </Button>
            ))}
          </div>
        )}
        {workspace && state === "ready" && view === "approvals" && (
          <BotAttention environmentId={environmentId} />
        )}
        {workspace && view === "workflows" && state === "ready" && host.data?.hostId && (
          <>
            <BotEvents
              key={`events:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
            <BotRoutineFlows
              key={`flows:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
          </>
        )}
        {workspace && view === "workflows" && state === "ready" && host.data?.hostId && (
          <BotWorkflows
            key={`workflows:${host.data.hostId}`}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {workspace && view === "channels" && state === "ready" && host.data?.hostId && (
          <>
            <BotChannels
              key={`channels:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
            <BotChannelExtras
              key={`channel-extras:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
          </>
        )}
        {workspace && view === "bots" && state === "ready" && (
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
            {creating && creationForm}
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
            {selected &&
              selectedHostId === host.data?.hostId &&
              agents.data?.some((bot) => bot.id === selected) && (
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
export function BotDetail({
  environmentId,
  agentId,
  expectedHostId,
  initialTaskId,
  initialRoutineId,
  initialRoutineRunId,
  workspaceView,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  expectedHostId: string;
  initialTaskId?: string;
  initialRoutineId?: string;
  initialRoutineRunId?: string;
  workspaceView?: BotTab;
}) {
  const pendingMessage = useRef<{ text: string; id: string } | null>(null);
  const messageIdFor = (value: string) => {
    if (pendingMessage.current?.text !== value)
      pendingMessage.current = { text: value, id: randomUUID() };
    return pendingMessage.current.id;
  };
  const [selectedTask, setSelectedTask] = useState<string | null>(initialTaskId ?? null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [memorySearch, setMemorySearch] = useState("");
  const [showMemoryEditor, setShowMemoryEditor] = useState(false);
  const [showRoutineEditor, setShowRoutineEditor] = useState(false);
  const [tab, setTab] = useState<BotTab>(
    workspaceView ?? (initialTaskId ? "task" : initialRoutineId ? "routine" : "conversation"),
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    tab === "conversation" || tab === "task"
      ? null
      : openbot.read({ environmentId, input: botViewRequest(agentId, tab, selectedTask) }),
  );
  const taskQuery = useEnvironmentQuery(
    tab === "task"
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: expectedHostId, request: { operation: "task.list", agentId } },
        })
      : null,
  );
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const coding = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.codingTasks({ environmentId, input: { hostId: host.data.hostId, agentId } })
      : null,
  );
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
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
      : await write({
          environmentId,
          input: { hostId: expectedHostId, request: input as OpenbotWriteRequest },
        });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      pendingMessage.current = null;
      setEditingMemory(null);
      setShowMemoryEditor(false);
      setText("");
      query.refresh();
      taskQuery.refresh();
    }
    setBusy(false);
  };
  const tasks = tab === "task" ? taskViews(taskQuery.data) : null;
  const memories = tab === "memory" ? memoryViews(query.data) : null;
  const routines = tab === "routine" ? routineViews(query.data) : null;
  if (host.data?.state !== "ready" || host.data.hostId !== expectedHostId) {
    return (
      <div role="status" className="space-y-2">
        <p>Reconnect to the original bot engine or select the bot again before continuing.</p>
        <Button size="sm" variant="outline" onClick={host.refresh}>
          Refresh engine
        </Button>
      </div>
    );
  }
  if (workspaceView === "task")
    return (
      <section className="flex min-h-0 flex-1" aria-label="Bot tasks">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/15">
          <div className="flex items-center justify-between p-4">
            <h2 className="text-sm font-semibold">Tasks</h2>
            <Button size="sm" variant="ghost" onClick={taskQuery.refresh}>
              Refresh
            </Button>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
            {tasks?.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  aria-pressed={selectedTask === task.id}
                  className={cn(
                    "w-full rounded-lg p-3 text-left hover:bg-muted",
                    selectedTask === task.id && "bg-muted",
                  )}
                  onClick={() => setSelectedTask(task.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {task.title || "Untitled task"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {task.state}
                    {task.outcome ? ` · ${task.outcome}` : ""}
                  </span>
                </button>
              </li>
            ))}
            {!tasks?.length && (
              <li className="p-3 text-sm text-muted-foreground">
                {taskQuery.isPending ? "Loading tasks…" : "No tasks yet"}
              </li>
            )}
          </ul>
          <form
            className="space-y-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim())
                void send({
                  operation: "task.start",
                  agentId,
                  text: text.trim(),
                  clientMessageId: messageIdFor(`task:${text.trim()}`),
                });
            }}
          >
            <label className="block text-xs font-medium">
              New task
              <Textarea
                aria-label="New task"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What should this bot do?"
                required
                maxLength={100000}
              />
            </label>
            <Button size="sm" type="submit" disabled={busy || !canWrite || !text.trim()}>
              {busy ? "Starting…" : "Start task"}
            </Button>
          </form>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {(error || taskQuery.error) && (
            <p role="alert" className="px-5 py-3 text-sm text-destructive">
              {error ?? taskQuery.error}
            </p>
          )}
          {selectedTask ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                <h2 className="truncate text-sm font-medium">
                  {tasks?.find((t) => t.id === selectedTask)?.title || "Task"}
                </h2>
                <div className="flex gap-2">
                  {tasks?.find((t) => t.id === selectedTask)?.state === "running" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !canWrite}
                      onClick={() =>
                        void send({ operation: "task.stop", agentId, taskId: selectedTask })
                      }
                    >
                      Stop
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !canWrite}
                    onClick={() =>
                      void send({
                        operation:
                          tasks?.find((t) => t.id === selectedTask)?.state === "closed"
                            ? "task.reopen"
                            : "task.close",
                        agentId,
                        taskId: selectedTask,
                      })
                    }
                  >
                    {tasks?.find((t) => t.id === selectedTask)?.state === "closed"
                      ? "Reopen"
                      : "Close task"}
                  </Button>
                </div>
              </div>
              <BotConversationPanel
                key={selectedTask}
                environmentId={environmentId}
                hostId={expectedHostId}
                agentId={agentId}
                taskId={selectedTask}
                workspace
              />
            </>
          ) : (
            <div className="m-auto max-w-sm space-y-2 p-8 text-center">
              <h2 className="text-xl font-medium">A space for each task</h2>
              <p className="text-sm text-muted-foreground">
                Open a task to pick up its conversation, or start a new one.
              </p>
            </div>
          )}
        </div>
      </section>
    );
  return (
    <section
      className={
        workspaceView ? "mx-auto w-full max-w-3xl space-y-6" : "space-y-4 rounded-lg border p-4"
      }
      aria-label="Bot workspace"
    >
      {workspaceView && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-balance text-xl font-semibold">
              {workspaceView === "memory" ? "Memory" : "Routines"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {workspaceView === "memory"
                ? "What this bot remembers across conversations."
                : "Work this bot repeats on a schedule."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={query.refresh} disabled={busy}>
              Reload
            </Button>
            <Button
              size="sm"
              disabled={busy || !canAdmin || (workspaceView === "routine" && !canWrite)}
              onClick={() => {
                if (workspaceView === "memory") {
                  setEditingMemory(null);
                  setText("");
                  setMemorySearch("");
                  setShowMemoryEditor(true);
                } else setShowRoutineEditor(true);
              }}
            >
              <PlusIcon aria-hidden className="size-4" />
              {workspaceView === "memory" ? "Add memory" : "New routine"}
            </Button>
          </div>
        </header>
      )}
      {!workspaceView && (
        <details>
          <summary>Agent settings</summary>
          <BotSettingsEnvironment
            key={`${environmentId}:${expectedHostId}:${agentId}`}
            environmentId={environmentId}
            hostId={expectedHostId}
            agentId={agentId}
          />
        </details>
      )}
      {!workspaceView && (
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
      )}
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
      {tasks?.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks yet. Start one below.</p>
      )}
      {memories?.length === 0 && (
        <div className="rounded-2xl bg-muted/25 px-6 py-10 text-center">
          <BrainIcon aria-hidden className="mx-auto mb-3 size-6 text-muted-foreground" />
          <h3 className="text-balance text-sm font-medium">A little context goes a long way</h3>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm text-muted-foreground">
            Save preferences, facts, and instructions this bot should remember across conversations.
          </p>
        </div>
      )}
      {routines?.length === 0 && (
        <div className="rounded-2xl bg-muted/25 px-6 py-10 text-center">
          <CalendarClockIcon aria-hidden className="mx-auto mb-3 size-6 text-muted-foreground" />
          <h3 className="text-balance text-sm font-medium">Put recurring work on a schedule</h3>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm text-muted-foreground">
            Create a daily routine and this bot will take care of it at the time you choose.
          </p>
        </div>
      )}
      {(tab === "conversation" || (tab === "task" && selectedTask !== null)) && (
        <BotConversationPanel
          environmentId={environmentId}
          hostId={expectedHostId}
          agentId={agentId}
          taskId={tab === "task" ? selectedTask : null}
        />
      )}
      {tasks && selectedTask === null && (
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
      {memories && memories.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <Input
                aria-label="Search memories"
                placeholder="Search memories"
                value={memorySearch}
                onChange={(event) => setMemorySearch(event.target.value)}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {memories.length} saved
            </span>
          </div>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25">
            {memories
              .filter((memory) =>
                memory.text.toLocaleLowerCase().includes(memorySearch.trim().toLocaleLowerCase()),
              )
              .map((memory) => (
                <li key={memory.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                  <p className="min-w-0 flex-1 basis-48 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">
                    {memory.text}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !canAdmin}
                      onClick={() => {
                        setEditingMemory(memory.id);
                        setText(memory.text);
                        setShowMemoryEditor(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !canAdmin}
                      onClick={async () => {
                        const approved =
                          (await requestConfirmDialog("Delete this saved memory?", {
                            variant: "destructive",
                          })) ?? window.confirm("Delete this saved memory?");
                        if (approved)
                          void send(
                            { operation: "memory.delete", agentId, memoryId: memory.id },
                            true,
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
          {!memories.some((memory) =>
            memory.text.toLocaleLowerCase().includes(memorySearch.trim().toLocaleLowerCase()),
          ) && (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              No memories match this search.
            </p>
          )}
        </div>
      )}
      {tab === "memory" && !canAdmin && (
        <p className="text-sm text-muted-foreground">
          You can read memories. Host settings permission is required to add, edit, or delete them.
        </p>
      )}
      {initialRoutineId && (
        <BotRoutineNotification
          environmentId={environmentId}
          hostId={expectedHostId}
          agentId={agentId}
          routineId={initialRoutineId}
          {...(initialRoutineRunId === undefined ? {} : { runId: initialRoutineRunId })}
        />
      )}
      {routines && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25">
          {routines.map((routine) => (
            <li key={routine.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <CalendarClockIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <h3 className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">{routine.name}</h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    routine.active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {routine.active ? "Active" : "Paused"}
                </span>
              </div>
              <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-muted-foreground">
                {routine.instruction}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canAdmin || !canWrite}
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
      {query.data !== null && query.data !== undefined && !tasks && !memories && !routines && (
        <p role="alert" className="text-sm text-muted-foreground">
          This host returned an unsupported format. Update the integration before editing this view.
        </p>
      )}
      {!workspaceView && (
        <>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">
              Model, instructions and coding destinations
            </summary>
            <BotProviderSettings
              environmentId={environmentId}
              agentId={agentId}
              hostId={expectedHostId}
            />
            <BotConfiguration
              environmentId={environmentId}
              agentId={agentId}
              hostId={expectedHostId}
            />
            <BotCodingPolicy
              key={`policy:${expectedHostId}:${agentId}`}
              environmentId={environmentId}
              hostId={expectedHostId}
              agentId={agentId}
            />
          </details>
          {host.data?.state === "ready" && host.data.hostId === expectedHostId && (
            <>
              <DataEnvironment
                key={`data:${environmentId}:${expectedHostId}`}
                environmentId={environmentId}
                hostId={expectedHostId}
              />
              <ComputerEnvironment
                key={`${environmentId}:${expectedHostId}`}
                environmentId={environmentId}
                hostId={expectedHostId}
              />
              <BotBrowser
                key={`${environmentId}:${expectedHostId}:${agentId}`}
                environmentId={environmentId}
                agentId={agentId}
                hostId={expectedHostId}
              />
            </>
          )}
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
        </>
      )}
      {tab === "routine" && (!canAdmin || !canWrite) && (
        <p className="text-sm text-muted-foreground">
          Host settings and bot operation permissions are required to manage routines.
        </p>
      )}
      {tab === "routine" && routines !== null && (!workspaceView || showRoutineEditor) && (
        <div className="space-y-3">
          {workspaceView && (
            <Button size="sm" variant="ghost" onClick={() => setShowRoutineEditor(false)}>
              Cancel
            </Button>
          )}
          <DailyRoutineForm
            environmentId={environmentId}
            agentId={agentId}
            hostId={expectedHostId}
            onCreated={() => {
              query.refresh();
              setShowRoutineEditor(false);
            }}
          />
        </div>
      )}
      {tab !== "routine" &&
        ((tasks !== null && selectedTask === null) ||
          (memories !== null && (!workspaceView || showMemoryEditor))) && (
          <form
            className={tab === "memory" ? "space-y-4 rounded-xl bg-muted/30 p-4" : "space-y-2"}
            onSubmit={(event) => {
              event.preventDefault();
              if (!text.trim()) return;
              const clientMessageId = messageIdFor(
                `${tab}:${selectedTask ?? "main"}:${text.trim()}`,
              );
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
                  : { operation: "task.start", agentId, text: text.trim(), clientMessageId },
                tab === "memory",
              );
            }}
          >
            <label className="block space-y-1 text-sm">
              <span className="font-medium">
                {tab === "task" ? "New task" : editingMemory ? "Edit memory" : "New memory"}
              </span>
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={tab === "memory" ? 500 : 100000}
                placeholder={tab === "memory" ? "What should this bot remember?" : undefined}
                rows={4}
                required
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                type="submit"
                disabled={busy || !text.trim() || (tab === "memory" ? !canAdmin : !canWrite)}
              >
                {busy
                  ? "Sending…"
                  : tab === "task"
                    ? "Start task"
                    : editingMemory
                      ? "Save memory"
                      : "Add memory"}
              </Button>
              {tab === "memory" && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditingMemory(null);
                      setText("");
                      setShowMemoryEditor(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {text.length}/500
                  </span>
                </>
              )}
            </div>
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
  const canOperate = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
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
      className="space-y-4 rounded-xl bg-muted/30 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="space-y-1">
        <h4 className="text-balance text-sm font-medium">New daily routine</h4>
        <p className="text-pretty text-xs text-muted-foreground">
          This bot will run these instructions every day at the scheduled time.
        </p>
      </div>
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
        disabled={
          busy ||
          !canAdmin ||
          !canOperate ||
          !name.trim() ||
          !instruction.trim() ||
          !timezone.trim()
        }
      >
        {busy ? "Creating…" : "Create routine"}
      </Button>
    </form>
  );
}
