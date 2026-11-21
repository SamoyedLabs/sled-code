import {
  BotMessageComposer,
  BotComposerInput,
  BotComposerFooter,
  BotComposerSend,
  BotComposerVoice,
  BotComposerVoiceStatus,
  BotComposerRecipient,
} from "../../../settings/BotMessageComposer";
import { ComposerControl } from "../../../chat/ComposerControl";
import { SourceModelPicker } from "../../SourceProviderEnvironment";
/* oxlint-disable shadcn/no-unknown-classes -- OpenBot TasksPage selectors are supplied by tasks.css. */
import { useContext, useMemo, useRef, useState, useEffect } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { EnvironmentId, OpenbotWriteRequest, OpenbotDraftFile } from "@t3tools/contracts";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Check,
  Circle,
  Square,
  X,
  Paperclip,
} from "lucide-react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { formatEnvironmentQueryError } from "../../../../state/query";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { useEnvironmentQuery } from "../../../../state/query";
import { useBotDictation } from "../../../settings/BotDictation";
import { randomUUID } from "../../../../lib/utils";
import { BotAvatar } from "../../avatar/BotAvatar";
import { BotComposerEditor } from "../../../settings/BotComposerEditor";
import { BotConversationPanel } from "../../../settings/BotConversationPanel";
import { taskSections, taskSnapshot, taskStatus, type Task } from "./taskModel";
import { TasksEmptyBoard } from "./TasksEmpty";
import { useNewThreadAttachments } from "./useNewThreadAttachments";
import { BotComposerAttachments } from "../../../settings/BotComposerAttachments";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { readPreparedConnection } from "../../../../state/session";
import {
  readGlobalTaskAttempt,
  saveGlobalTaskAttempt,
  clearGlobalTaskAttempt,
  globalTaskCreated,
  type GlobalTaskAttempt,
} from "./globalTaskStart";
import "./tasks.css";
import "./tasks-adapter.css";
import { T, useGT } from "gt-react";

type Agent = {
  id: string;
  name: string;
  avatarSeed?: string | undefined;
  avatarHue?: number | null | undefined;
};
export type TasksPageProps = {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  agents: readonly Agent[];
  onBack?: () => void;
};
export function TasksPage(props: TasksPageProps) {
  return <TasksBody key={`${props.environmentId}:${props.hostId}`} {...props} />;
}
function TasksBody({ environmentId, hostId, hostName = "", agents, onBack }: TasksPageProps) {
  const gt = useGT();
  const registry = useContext(RegistryContext);
  const agentIds = JSON.stringify(agents.map((agent) => agent.id));
  // oxlint-disable-next-line t3code/no-manual-memo -- Query atom identity owns live subscriptions and must stay stable while composer state changes.
  const queries = useMemo(
    () =>
      (JSON.parse(agentIds) as string[]).map((agentId) =>
        openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "task.list", agentId } },
        }),
      ),
    [agentIds, environmentId, hostId],
  );
  // oxlint-disable-next-line t3code/no-manual-memo -- A stable derived atom prevents disposing and reopening host subscriptions on each draft keystroke.
  const combined = useMemo(() => Atom.make((get) => queries.map((query) => get(query))), [queries]);
  const results = useAtomValue(combined);
  const tasks = results.flatMap(
    (result) => taskSnapshot(AsyncResult.getOrElse(result, () => null)) ?? [],
  );
  const loaded = results.every((result) => result._tag === "Success");
  const loadError = results.flatMap((result) =>
    result._tag === "Failure"
      ? [formatEnvironmentQueryError(result.cause)]
      : result._tag === "Success" && taskSnapshot(result.value) === null
        ? ["The host returned an unsupported task list."]
        : [],
  )[0];
  const startScope = JSON.stringify([environmentId, hostId]);
  const [restored] = useState(() => {
    try {
      return readGlobalTaskAttempt(startScope, window.sessionStorage);
    } catch {
      return null;
    }
  });
  const [agentChoice, setAgentChoice] = useState(restored?.agentId ?? "");
  const agentId = agents.find((agent) => agent.id === agentChoice)?.id ?? agents[0]?.id ?? "";
  const [draft, setDraft] = useState("");
  const voice = useBotDictation(
    JSON.stringify(["tasks", environmentId, hostId, agentId]),
    draft,
    setDraft,
  );
  const attention = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const waitingFor = (task: Task) =>
    attention.data?.hostId === hostId &&
    attention.data.requests.some(
      (request) => request.agentId === task.agentId && request.threadId === task.threadId,
    );
  const [selected, setSelected] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [took, setTook] = useState<Task | null>(null);
  const [pending, setPending] = useState<GlobalTaskAttempt | null>(restored);
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const lock = useRef(false);
  const [files, setFiles] = useState<readonly OpenbotDraftFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<readonly string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const staged = useEnvironmentQuery(
    openbot.fileDrafts({ environmentId, input: { hostId, agentId } }),
  );
  const selectedFiles = selectedFileIds.flatMap((id) => {
    const draft =
      files.find((file) => file.attachment.id === id) ??
      staged.data?.find((file) => file.attachment.id === id);
    return draft ? [draft.attachment] : [];
  });
  const uploads = useNewThreadAttachments(
    environmentId,
    hostId,
    agentId,
    busy || pending !== null,
    (draft) => {
      setFiles((current) => [...current, draft]);
      setSelectedFileIds((current) => [...current, draft.attachment.id]);
    },
  );
  const startText = useAtomCommand(openbot.newTaskStart, { reportFailure: false });
  const sendFiles = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const fileContext = useAtomQueryRunner(openbot.fileContext, {
    reportFailure: false,
    refresh: true,
  });
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const canSendFiles = useAtomValue(
    openbot.fileSendDraft.permissionAtom(environmentId, {
      hostId,
      agentId,
      attachmentId: selectedFileIds[0] ?? "unselected",
      text: draft,
      target: { kind: "new-task" },
    }),
  );
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(pending);
  const send = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const permission = useAtomValue(
    openbot.writeToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "task.start",
        agentId: agentId || "permission",
        text: "permission",
        clientMessageId: "permission",
      },
    }),
  );
  const refresh = () => queries.forEach((query) => registry.refresh(query));
  async function act(request: OpenbotWriteRequest) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const result = await send({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") {
        setError(String(squashAtomCommandFailure(result)));
        return null;
      }
      refresh();
      return result.value;
    });
    lock.current = false;
    setBusy(false);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : gt("The task request failed. Try again."));
      return null;
    }
    return settled.value;
  }
  function persist(next: GlobalTaskAttempt) {
    try {
      return saveGlobalTaskAttempt(startScope, next, window.sessionStorage);
    } catch {
      return false;
    }
  }
  async function principal() {
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw Error("Reconnect before starting a task.");
    const bound = await fileContext({ environmentId, input: { hostId } });
    if (bound._tag === "Failure") throw squashAtomCommandFailure(bound);
    if (readPreparedConnection(environmentId) !== connection)
      throw Error("The original connection changed. No replacement task was started.");
    return bound.value.principalId;
  }
  async function commit() {
    const original = pendingRef.current;
    if (!original || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const next: GlobalTaskAttempt = { ...original, phase: "attempted" };
    const settled = await settlePromise(async () => {
      if ((await principal()) !== next.principalId)
        throw Error(
          "This start belongs to the original sign-in. It will not be started again from another session.",
        );
      if (!persist(next))
        throw Error("The original start could not be saved. No task was started.");
      pendingRef.current = next;
      if (alive.current) setPending(next);
      let taskId: string;
      if (next.fileIds.length) {
        const sent = await sendFiles({
          environmentId,
          input: {
            hostId,
            agentId: next.agentId,
            attachmentId: next.fileIds[0]!,
            attachmentIds: next.fileIds,
            text: next.text,
            target: { kind: "new-task" },
          },
        });
        if (sent._tag === "Failure") throw squashAtomCommandFailure(sent);
        if (sent.value.state !== "sent" || !sent.value.taskId)
          throw Error(
            "The host has not confirmed this start. Check the same attempt before starting another.",
          );
        taskId = sent.value.taskId;
      } else {
        const sent = await startText({
          environmentId,
          input: {
            hostId,
            agentId: next.agentId,
            clientMessageId: next.requestId,
            text: next.text,
          },
        });
        if (sent._tag === "Failure") throw squashAtomCommandFailure(sent);
        const created = globalTaskCreated(sent.value, next.agentId);
        if (!created) throw Error("The host did not confirm the original task identity.");
        taskId = created;
      }
      clearGlobalTaskAttempt(startScope, window.sessionStorage);
      pendingRef.current = null;
      if (alive.current) {
        setPending(null);
        refresh();
      }
      const listed = await read({
        environmentId,
        input: { hostId, request: { operation: "task.list", agentId: next.agentId } },
      });
      if (alive.current && listed._tag === "Success")
        setTook(taskSnapshot(listed.value)?.find((task) => task.id === taskId) ?? null);
    });
    if (settled._tag === "Failure" && alive.current) {
      const cause = squashAtomCommandFailure(settled);
      setError(
        cause instanceof Error
          ? cause.message
          : gt("The original task start could not be confirmed. Check it before starting another."),
      );
    }
    lock.current = false;
    if (alive.current) setBusy(false);
  }
  async function start() {
    if (
      lock.current ||
      (!draft.trim() && !selectedFileIds.length) ||
      !permission ||
      busy ||
      pending ||
      voice.busy ||
      uploads.busy ||
      !agentId ||
      (selectedFileIds.length && !canSendFiles)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const principalId = await principal();
      const next: GlobalTaskAttempt = {
        agentId,
        principalId,
        text: draft.trim(),
        requestId: randomUUID(),
        fileIds: selectedFileIds,
        phase: "queued",
      };
      if (!persist(next)) throw Error("The start request could not be saved. No task was started.");
      pendingRef.current = next;
      setPending(next);
      setDraft("");
      setSelectedFileIds([]);
      setTook(null);
      timer.current = setTimeout(() => void commit(), 6000);
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : gt("The task could not be queued."));
    }
    lock.current = false;
    setBusy(false);
  }
  function undo() {
    if (pendingRef.current?.phase !== "queued" || lock.current) return;
    if (timer.current) clearTimeout(timer.current);
    if (!clearGlobalTaskAttempt(startScope, window.sessionStorage)) {
      setError(gt("The cancellation could not be saved. The original pending start is retained."));
      return;
    }
    setDraft(pendingRef.current.text);
    setSelectedFileIds(pendingRef.current.fileIds);
    setAgentChoice(pendingRef.current.agentId);
    pendingRef.current = null;
    setPending(null);
  }
  async function changeAgent(nextAgentId: string) {
    if (busy || uploads.busy || lock.current || pendingRef.current?.phase === "attempted") return;
    const original = pendingRef.current;
    lock.current = true;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    let stagedMove: readonly OpenbotDraftFile[] | null = null;
    const settled = await settlePromise(async () => {
      if (original && (await principal()) !== original.principalId)
        throw Error("Only the original sign-in can change this pending start.");
      const ids = original?.fileIds ?? selectedFileIds;
      const originals = ids.map(
        (id) =>
          files.find((file) => file.attachment.id === id) ??
          staged.data?.find((file) => file.attachment.id === id),
      );
      if (originals.some((file) => !file))
        throw Error("Recover the original attachments before changing the task agent.");
      const moved = ids.length
        ? await uploads.reassign(
            originals.filter((file): file is OpenbotDraftFile => file !== undefined),
            nextAgentId,
          )
        : [];
      if (!moved)
        throw Error("The attachments could not be moved. The original task agent is retained.");
      stagedMove = moved;
      const nextIds = moved.map((file) => file.attachment.id);
      if (original) {
        const next = { ...original, agentId: nextAgentId, fileIds: nextIds };
        if (!persist(next))
          throw Error(
            "The changed pending start could not be saved. Check its original files before continuing.",
          );
        pendingRef.current = next;
        setPending(next);
        timer.current = setTimeout(() => void commit(), 6000);
      } else setSelectedFileIds(nextIds);
      setFiles((current) => [...current, ...moved]);
      setAgentChoice(nextAgentId);
      stagedMove = null;
      void uploads.discardUnused(
        originals.filter((file): file is OpenbotDraftFile => file !== undefined),
      );
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      if (stagedMove) void uploads.discardUnused(stagedMove);
      setError(
        cause instanceof Error ? cause.message : gt("The original pending start is retained."),
      );
    }
    lock.current = false;
    setBusy(false);
  }
  const commitPending = useStableCallback(commit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Commit an authorized pending start on navigation, matching upstream TasksView cleanup.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (pendingRef.current?.phase === "queued") void commitPending();
    };
  }, [commitPending]);
  const selectTask = useStableCallback((id: string | null) => {
    setSelected(id);
    if (id) {
      setShown(id);
      setClosing(false);
    } else setClosing(true);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the source side panel mounted during its CSS exit and handle document Escape after popup handlers.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
      )
        return;
      selectTask(null);
    };
    document.addEventListener("keydown", close);
    const timeout = !selected
      ? setTimeout(() => {
          setShown(null);
          setClosing(false);
        }, 300)
      : undefined;
    return () => {
      document.removeEventListener("keydown", close);
      clearTimeout(timeout);
    };
  }, [selected, selectTask]);
  const selectedTask = tasks.find((task) => task.id === shown);
  const empty = loaded && tasks.length === 0;
  return (
    <section className="tasks-page" aria-label={gt("Tasks")} data-empty={empty ? "" : undefined}>
      <div className="tasks-page-scroll">
        <div className="tasks-page-column">
          <header className="tasks-page-header">
            {onBack && (
              <button className="ui-icon-button" aria-label={gt("Back")} onClick={onBack}>
                <ArrowLeft size={16} />
              </button>
            )}
            <h2>
              <T>Tasks</T>{" "}
              {hostName && (
                <>
                  <span>/</span> <span>{hostName}</span>
                </>
              )}
            </h2>
            <button className="ui-button" onClick={refresh}>
              <T>Refresh</T>
            </button>
          </header>
          {empty && (
            <div className="tasks-page-empty-pitch">
              <h3 className="tasks-page-empty-title">
                <span className="tasks-page-empty-lead">
                  <T>Hand off the work.</T>
                </span>
                <span>
                  <T>Come back to an</T> <span className="tasks-page-empty-word">answer</span>.
                </span>
              </h3>
              <p className="tasks-page-empty-lines">
                <span>
                  <T>Your agents work on tasks side by side.</T>
                </span>
                <span>
                  <T>Each answer waits here for you.</T>
                </span>
              </p>
            </div>
          )}
          {(error || uploads.error || loadError) && (
            <p role="alert">{error ?? uploads.error ?? loadError}</p>
          )}
          {!loaded && !loadError && (
            <p role="status">
              <T>Loading tasks…</T>
            </p>
          )}
          <div className="composer-wrap tasks-page-composer">
            <BotMessageComposer
              onDragOver={(event) => {
                if (uploads.available && event.dataTransfer.types.includes("Files"))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (uploads.available && event.dataTransfer.files.length) {
                  event.preventDefault();
                  void uploads.add(Array.from(event.dataTransfer.files), selectedFileIds.length);
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label={gt("Choose task attachments")}
                onChange={(event) => {
                  void uploads.add(
                    Array.from(event.currentTarget.files ?? []),
                    selectedFileIds.length,
                  );
                  event.currentTarget.value = "";
                }}
              />
              <BotComposerAttachments
                files={selectedFiles}
                uploads={[]}
                disabled={busy || pending !== null}
                reorderDisabled={uploads.busy}
                onReorder={setSelectedFileIds}
                onRemove={(id) => setSelectedFileIds((ids) => ids.filter((value) => value !== id))}
                onRemoveUpload={() => {}}
                onRetry={() => {}}
              />
              {uploads.busy && (
                <p role="status">
                  <T>Uploading files…</T>
                </p>
              )}
              <BotComposerInput>
                <BotComposerEditor
                  environmentId={environmentId}
                  hostId={hostId}
                  agentId={agentId}
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void start()}
                  disabled={!permission || busy || voice.busy || pending !== null || !agentId}
                  placeholder={gt("What would you like done?")}
                  attachments={selectedFiles.map((file) => ({ id: file.id, name: file.name }))}
                  onFiles={
                    uploads.available
                      ? (files) => void uploads.add(files, selectedFileIds.length)
                      : undefined
                  }
                />
              </BotComposerInput>
              <BotComposerFooter
                actions={
                  <>
                    <BotComposerRecipient
                      label={gt("Task agent")}
                      value={agentId}
                      onChange={(id) => void changeAgent(id)}
                      choices={agents}
                      disabled={busy || uploads.busy || Boolean(pending)}
                    />
                    {agentId && (
                      <SourceModelPicker
                        environmentId={environmentId}
                        hostId={hostId}
                        agentId={agentId}
                        disabled={busy || Boolean(pending) || uploads.busy}
                      />
                    )}
                    <BotComposerVoice
                      voice={voice}
                      disabled={!permission || busy || Boolean(pending)}
                    />
                    <BotComposerSend
                      aria-label={gt("Start task")}
                      busy={busy}
                      disabled={
                        (!draft.trim() && !selectedFileIds.length) ||
                        !permission ||
                        busy ||
                        voice.busy ||
                        uploads.busy ||
                        Boolean(pending) ||
                        !agentId ||
                        (selectedFileIds.length > 0 && !canSendFiles)
                      }
                    />
                  </>
                }
              >
                <ComposerControl
                  type="button"
                  className="size-8 px-0"
                  aria-label={gt("Attach task files")}
                  disabled={
                    !permission ||
                    !uploads.available ||
                    !canSendFiles ||
                    pending !== null ||
                    !agentId
                  }
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={18} />
                </ComposerControl>
              </BotComposerFooter>
              <BotComposerVoiceStatus voice={voice} />
            </BotMessageComposer>
          </div>
          {!permission && (
            <p className="tasks-page-permission">
              <T>Chat permission is required to start or change tasks.</T>
            </p>
          )}
          <div className="tasks-page-took-slot" aria-live="polite">
            {(pending || took) && (
              <div className="tasks-page-took">
                <span>
                  {agents.find((item) => item.id === (pending?.agentId ?? took?.agentId))?.name}{" "}
                  {pending?.phase === "attempted" ? gt("is confirming") : "took"} “
                  {pending?.text || (pending?.fileIds.length ? gt("attached files") : took?.title)}”
                </span>
                {pending ? (
                  <>
                    <select
                      aria-label={gt("Pending task agent")}
                      value={pending.agentId}
                      disabled={busy || uploads.busy || pending.phase === "attempted"}
                      onChange={(event) => void changeAgent(event.target.value)}
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ui-button"
                      disabled={busy || pending.phase !== "queued"}
                      onClick={undo}
                    >
                      <T>Undo</T>
                    </button>
                    <button
                      className="ui-button"
                      onClick={() => {
                        if (timer.current) clearTimeout(timer.current);
                        void commit();
                      }}
                    >
                      {pending.phase === "attempted" ? gt("Check original start") : gt("Start now")}
                    </button>
                  </>
                ) : (
                  took && (
                    <>
                      <button className="ui-button" onClick={() => selectTask(took.id)}>
                        <T>Open</T>
                      </button>
                      <button
                        className="ui-icon-button"
                        aria-label={gt("Dismiss")}
                        onClick={() => setTook(null)}
                      >
                        <X size={14} />
                      </button>
                    </>
                  )
                )}
              </div>
            )}
          </div>
          {taskSections(tasks, showClosed, waitingFor).map(
            (section) =>
              section.tasks.length > 0 && (
                <section
                  key={section.id}
                  className="tasks-page-section"
                  data-closed={section.id === "closed" ? "" : undefined}
                  aria-label={section.title}
                >
                  <h3 className="tasks-page-section-heading">
                    <span>{section.title}</span>
                    <span className="tasks-page-count">
                      {section.count ?? section.tasks.length}
                    </span>
                  </h3>
                  <ul className="tasks-page-list">
                    {section.tasks.map((task) => (
                      <li key={task.id}>
                        <button
                          className="ui-button tasks-page-row"
                          data-selected={task.id === selected ? "" : undefined}
                          aria-pressed={task.id === selected}
                          onClick={() => selectTask(task.id === selected ? null : task.id)}
                        >
                          {task.outcome === "completed" ? (
                            <Check size={15} />
                          ) : (
                            <Circle size={15} />
                          )}
                          <span className="tasks-page-row-title">{task.title}</span>
                          <span
                            className="tasks-page-status"
                            data-tone={
                              task.state === "running"
                                ? "working"
                                : task.outcome === "failed"
                                  ? "danger"
                                  : undefined
                            }
                          >
                            {waitingFor(task) ? gt("Needs you") : taskStatus(task)}
                          </span>
                          <BotAvatar
                            seed={
                              agents.find((item) => item.id === task.agentId)?.avatarSeed ??
                              task.agentId
                            }
                            size={18}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {section.id === "closed" && (section.count ?? 0) > 2 && (
                    <button
                      className="ui-button tasks-page-show-all"
                      aria-expanded={showClosed}
                      onClick={() => setShowClosed(!showClosed)}
                    >
                      {showClosed
                        ? gt("Show less")
                        : gt("Show all {count}", { count: section.count })}
                    </button>
                  )}
                </section>
              ),
          )}
          {empty && <TasksEmptyBoard agents={agents} />}
        </div>
      </div>
      {selectedTask && (
        <div className="tasks-page-side" data-closing={closing ? "" : undefined}>
          <div className="tasks-page-side-content">
            <aside
              className="browser-panel tasks-panel"
              aria-label={gt("Task: {title}", { title: selectedTask.title })}
            >
              <header className="file-preview-header">
                <h2>{selectedTask.title}</h2>
                {selectedTask.state === "running" || selectedTask.state === "queued" ? (
                  <button
                    className="ui-icon-button"
                    aria-label={gt("Stop task")}
                    disabled={!permission || busy}
                    onClick={() =>
                      void act({
                        operation: "task.stop",
                        agentId: selectedTask.agentId,
                        taskId: selectedTask.id,
                      })
                    }
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    className="ui-icon-button"
                    aria-label={
                      selectedTask.state === "closed" ? gt("Restore task") : gt("Archive task")
                    }
                    disabled={!permission || busy}
                    onClick={() =>
                      void act({
                        operation: selectedTask.state === "closed" ? "task.reopen" : "task.close",
                        agentId: selectedTask.agentId,
                        taskId: selectedTask.id,
                      })
                    }
                  >
                    {selectedTask.state === "closed" ? (
                      <ArchiveRestore size={14} />
                    ) : (
                      <Archive size={14} />
                    )}
                  </button>
                )}
                <button
                  className="ui-icon-button"
                  aria-label={gt("Close task panel")}
                  onClick={() => selectTask(null)}
                >
                  <X size={14} />
                </button>
              </header>
              <BotConversationPanel
                environmentId={environmentId}
                hostId={hostId}
                agentId={selectedTask.agentId}
                taskId={selectedTask.id}
                workspace
              />
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
