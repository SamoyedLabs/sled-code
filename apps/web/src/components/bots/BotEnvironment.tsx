import { BotSettingsEnvironment } from "../settings/BotSettingsEnvironment";
import { BotRoutineNotification } from "./BotRoutineNotification";
import { DataEnvironment } from "../settings/DataEnvironment";
import { BotConversationPanel } from "../settings/BotConversationPanel";
import { BotProviderSettings } from "../settings/BotProviderSettings";
import { BotConfiguration } from "../settings/BotConfiguration";
import { BotFiles } from "../settings/BotFiles";
import { ComputerEnvironment } from "../settings/ComputerEnvironment";
import { BotBrowser } from "../settings/BotBrowser";
import { BotCodingPolicy } from "../settings/BotCodingPolicy";
import { requestConfirmDialog } from "../../confirmDialog";
import { Link } from "@tanstack/react-router";
import { randomUUID, cn } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { BrainIcon, CalendarClockIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { EnvironmentId, OpenbotAdminRequest, OpenbotWriteRequest } from "@t3tools/contracts";
import {
  botViewRequest,
  memoryViews,
  routineViews,
  taskViews,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

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
