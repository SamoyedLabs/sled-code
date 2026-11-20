import { prependBotHistoryWindow } from "./botHistoryWindow";
import { botSelectionSendRequest } from "./botSelectionModel";
import { insertBotDrafts, reorderBotDrafts } from "./botComposerAttachmentOrder";
import { taskQueueAttachmentChoices } from "@t3tools/client-runtime/openbot/queue-attachments";
import { selectableDraft, acceptedDraft } from "@t3tools/client-runtime/openbot/rich-conversation";
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotWriteRequest,
  OpenbotConversationPage,
  OpenbotDraftFile,
} from "@t3tools/contracts";
import {
  botConversationPage,
  botConversationSnapshot,
  botQueueSnapshot,
  boundedBotMessages,
} from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { readPreparedConnection } from "../../state/session";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotConversationPanel(
  environmentId: EnvironmentId,
  hostId: string,
  agentId: string,
  taskId: string | null,
  newId: () => string,
  focusMessageId?: string,
) {
  const [pages, setPages] = useState<readonly OpenbotConversationPage[]>([]);
  const [anchored, setAnchored] = useState<{
    page: OpenbotConversationPage;
    baseRevision: number;
    kind: "around" | "latest";
  } | null>(null);
  const windowRequest = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Invalidate a pending read-only quote jump when its identity-scoped conversation unmounts.
  useEffect(
    () => () => {
      windowRequest.current += 1;
    },
    [],
  );
  const [text, setText] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<readonly string[]>([]);
  const selectedDraftId = selectedDraftIds[0] ?? null;
  const setSelectedDraftId = (id: string | null) => setSelectedDraftIds(id ? [id] : []);
  const [fileAttempt, setFileAttempt] = useState<{
    id: string;
    ids: readonly string[];
    text: string;
    reply: string | null;
  } | null>(null);
  const target = taskId ? { kind: "task" as const, taskId } : { kind: "main" as const };
  const scope = { hostId, agentId };
  const drafts = useEnvironmentQuery(openbot.fileDrafts({ environmentId, input: scope }));
  const fileSend = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const filePermission = useAtomValue(
    openbot.fileSendDraft.permissionAtom(environmentId, {
      ...scope,
      attachmentId: selectedDraftId ?? "unselected",
      text: fileAttempt?.text ?? text,
      target,
    }),
  );
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const receipts = useRef(new Map<string, string>());
  const history = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "conversation.page",
          agentId,
          taskId,
          deferDetails: true,
          anchor: focusMessageId
            ? { type: "around", messageId: focusMessageId }
            : { type: "latest" },
          limit: 50,
        },
      },
    }),
  );
  const queueQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: {
        hostId,
        request: taskId
          ? { operation: "task.list", agentId }
          : { operation: "queue.read", agentId },
      },
    }),
  );
  const latest = botConversationPage(history.data);
  const snapshot = latest ?? botConversationSnapshot(history.data);
  const queue = taskId ? null : botQueueSnapshot(queueQuery.data);
  const taskQueueChoices = taskId
    ? taskQueueAttachmentChoices(queueQuery.data, {
        agentId,
        taskId,
        threadId: snapshot?.agentId === agentId ? snapshot.threadId : null,
      })
    : null;
  const permission = useAtomValue(
    openbot.writeToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "conversation.markRead", agentId, throughMessageId: null },
    }),
  );
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const refresh = () => {
    windowRequest.current += 1;
    setAnchored(null);
    setPages([]);
    history.refresh();
    queueQuery.refresh();
  };
  const execute = async (request: OpenbotWriteRequest) => {
    if (lock.current || !permission) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(() => write({ environmentId, input: { hostId, request } }));
    lock.current = false;
    setBusy(false);
    if (settled._tag === "Failure" || settled.value._tag === "Failure") {
      setError(
        "The host refused the change or the connection was lost. Retry or release an uncertain edit before starting another.",
      );
      return null;
    }
    if (
      ["conversation.markRead", "conversation.markUnread", "thread.markRead"].includes(
        request.operation,
      )
    )
      history.refresh();
    else refresh();
    return { value: settled.value.value };
  };
  const act = async (request: OpenbotWriteRequest) => (await execute(request)) !== null;
  const markReadThrough = async (throughMessageId: string) => {
    if (!permission) return false;
    const request: OpenbotWriteRequest = taskId
      ? { operation: "thread.markRead", agentId, taskId, throughMessageId }
      : { operation: "conversation.markRead", agentId, throughMessageId };
    const result = await settlePromise(() => write({ environmentId, input: { hostId, request } }));
    if (result._tag === "Failure" || result.value._tag === "Failure") {
      setError("Could not update the read status. Use Mark read to retry.");
      return false;
    }
    history.refresh();
    return true;
  };
  const beginEdit = async (deliveryId: string, editId: string) => {
    const result = await execute({
      operation: "queue.edit",
      agentId,
      deliveryId,
      editId,
      action: "begin",
    });
    if (!result) return null;
    const acquired = botQueueSnapshot(result.value);
    const delivery =
      acquired?.agentId === agentId
        ? acquired.deliveries.find(
            (entry) =>
              entry.id === deliveryId && entry.status === "queued" && entry.editing === true,
          )
        : null;
    if (!delivery) {
      setError(
        "The edit could not be confirmed. Retry its begin or release it before editing another message.",
      );
      return null;
    }
    return delivery;
  };
  const stableId = (key: string) => {
    const existing = receipts.current.get(key);
    if (existing) return existing;
    const id = newId();
    if (receipts.current.size >= 100)
      receipts.current.delete(receipts.current.keys().next().value!);
    receipts.current.set(key, id);
    return id;
  };
  const sendSelection = async (messageId: string, body: string) => {
    if (fileAttempt || body.length > 100000 || !body.trim()) return false;
    const key = JSON.stringify(["selection", messageId, body]);
    const clientMessageId = stableId(key);
    const ok = await act(
      botSelectionSendRequest(agentId, taskId, messageId, body, clientMessageId),
    );
    if (ok) receipts.current.delete(key);
    return ok;
  };
  const send = async () => {
    if (selectedDraftId) {
      if (lock.current || !filePermission) return;
      const draft = drafts.data?.find((d) => d.attachment.id === selectedDraftId);
      if (draft && acceptedDraft(scope, target, selectedDraftId, draft)) {
        setSelectedDraftId(null);
        setFileAttempt(null);
        setReply(null);
        setText("");
        refresh();
        return;
      }
      if (!draft || !selectableDraft(scope, target, draft)) {
        setError("Refresh Files to reconcile this draft before sending.");
        return;
      }
      const ids = draft.batchAttachmentIds ?? selectedDraftIds;
      if (
        ids.some(
          (id) =>
            !drafts.data?.some(
              (item) => item.attachment.id === id && selectableDraft(scope, target, item),
            ),
        )
      ) {
        setError("Refresh Files before selecting this batch.");
        return;
      }
      const attempt = fileAttempt ?? {
        id: ids[0]!,
        ids,
        text: draft.sendText ?? text,
        reply: draft.replyToMessageId ?? reply,
      };
      setFileAttempt(attempt);
      lock.current = true;
      setBusy(true);
      setError(null);
      const result = await settlePromise(() =>
        fileSend({
          environmentId,
          input: {
            ...scope,
            attachmentId: attempt.id,
            attachmentIds: attempt.ids,
            text: attempt.text,
            target,
            ...(attempt.reply === null ? {} : { replyToMessageId: attempt.reply }),
          },
        }),
      );
      lock.current = false;
      setBusy(false);
      drafts.refresh();
      refresh();
      if (
        result._tag === "Success" &&
        result.value._tag === "Success" &&
        acceptedDraft(scope, target, attempt.id, result.value.value)
      ) {
        setSelectedDraftId(null);
        setFileAttempt(null);
        setReply(null);
        setText("");
      } else
        setError(
          "File acceptance is uncertain. Retry this same selection and original text, or reconcile in Files. Selection is not delivery.",
        );
      return;
    }
    if (!text.trim()) return;
    const key = JSON.stringify(["send", text, reply]);
    const clientMessageId = stableId(key);
    const ok = await act(
      taskId
        ? reply
          ? {
              operation: "thread.reply",
              agentId,
              taskId,
              text,
              replyToMessageId: reply,
              attachmentDraftIds: [],
              clientMessageId,
            }
          : { operation: "task.send", agentId, taskId, text, clientMessageId }
        : {
            operation: "conversation.send",
            agentId,
            text,
            replyToMessageId: reply,
            clientMessageId,
          },
    );
    if (ok) {
      receipts.current.delete(key);
      setText("");
      setReply(null);
    }
  };
  const branch = async (messageId: string) => {
    const key = `branch:${messageId}`;
    if (
      await act({
        operation: "thread.branch",
        agentId,
        taskId,
        messageId,
        requestId: stableId(key),
      })
    )
      receipts.current.delete(key);
  };
  const shownPage =
    anchored &&
    latest &&
    latest.threadId === anchored.page.threadId &&
    (anchored.kind === "around"
      ? latest.revision >= anchored.baseRevision
      : latest.revision < anchored.page.revision)
      ? anchored.page
      : latest;
  const loadWindow = async (messageId?: string) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection || !latest) return false;
    const request = ++windowRequest.current;
    const result = await settlePromise(() =>
      read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "conversation.page",
            agentId,
            taskId,
            deferDetails: true,
            anchor: messageId ? { type: "around", messageId } : { type: "latest" },
            limit: 50,
          },
        },
      }),
    );
    if (
      request !== windowRequest.current ||
      readPreparedConnection(environmentId) !== connection ||
      result._tag === "Failure" ||
      result.value._tag === "Failure"
    )
      return false;
    const page = botConversationPage(result.value.value);
    if (
      !page ||
      page.agentId !== agentId ||
      page.threadId !== latest.threadId ||
      (messageId && !page.messages.some((message) => message.id === messageId))
    )
      return false;
    setPages([]);
    setAnchored({ page, baseRevision: latest.revision, kind: messageId ? "around" : "latest" });
    return true;
  };
  // Appending or streaming at the tail must not discard the history the reader is viewing.
  const validPages = shownPage
    ? pages.filter((page) => page.agentId === agentId && page.threadId === shownPage.threadId)
    : [];
  const messages = shownPage
    ? boundedBotMessages(agentId, shownPage.threadId, [...validPages].reverse().concat([shownPage]))
    : snapshot?.agentId === agentId
      ? snapshot.messages
      : [];
  const cursor = validPages.length
    ? validPages.at(-1)!.pageInfo.olderCursor
    : shownPage?.pageInfo.olderCursor;
  const older = async () => {
    if (lock.current || !cursor) return;
    lock.current = true;
    setBusy(true);
    const settled = await settlePromise(() =>
      read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "conversation.page",
            agentId,
            taskId,
            deferDetails: true,
            anchor: { type: "before", cursor },
            limit: 50,
          },
        },
      }),
    );
    if (settled._tag === "Failure" || settled.value._tag === "Failure") {
      setError("Could not load older messages from the selected host.");
    } else {
      const value = botConversationPage(settled.value.value);
      if (value && latest && value.agentId === agentId && value.threadId === latest.threadId) {
        const window = prependBotHistoryWindow(shownPage ?? latest, validPages, value);
        if (!anchored || anchored.kind === "latest")
          setAnchored({ page: shownPage ?? latest, baseRevision: latest.revision, kind: "around" });
        if (window.shifted)
          setAnchored({ page: window.anchor, baseRevision: latest.revision, kind: "around" });
        setPages(window.older);
      }
    }
    lock.current = false;
    setBusy(false);
  };
  return {
    environmentId,
    hostId,
    agentId,
    taskId,
    selectedDraftId,
    selectedDraftIds,
    toggleDraft: (id: string) => {
      if (!fileAttempt && !busy)
        setSelectedDraftIds((current) =>
          current.includes(id)
            ? current.filter((value) => value !== id)
            : current.length < 10
              ? [...current, id]
              : current,
        );
    },
    setSelectedDraftId: (id: string | null) => {
      if (!fileAttempt) setSelectedDraftId(id);
    },
    refreshDrafts: drafts.refresh,
    addDrafts: (ids: readonly string[], beforeId?: string) => {
      if (!fileAttempt && !lock.current)
        setSelectedDraftIds((current) => insertBotDrafts(current, ids, beforeId));
    },
    canReorderDrafts:
      !fileAttempt &&
      !busy &&
      selectedDraftIds.every((id) =>
        drafts.data?.some(
          (draft) =>
            draft.attachment.id === id && draft.state === "ready" && !draft.batchAttachmentIds,
        ),
      ),
    reorderDrafts: (ids: readonly string[]) => {
      if (
        fileAttempt ||
        lock.current ||
        busy ||
        selectedDraftIds.some(
          (id) =>
            !drafts.data?.some(
              (draft) =>
                draft.attachment.id === id && draft.state === "ready" && !draft.batchAttachmentIds,
            ),
        )
      )
        return;
      setSelectedDraftIds((current) => reorderBotDrafts(current, ids));
    },
    fileAttempt,
    filePermission,
    fileDrafts: (drafts.data ?? []).filter(
      (d: OpenbotDraftFile) =>
        selectableDraft(scope, target, d) ||
        (d.hostId === hostId && d.agentId === agentId && d.attachment.id === selectedDraftId),
    ),
    text,
    setText,
    reply,
    setReply: (value: string | null) => {
      if (!fileAttempt) setReply(value);
    },
    busy,
    error:
      error ??
      history.error ??
      queueQuery.error ??
      (taskId && snapshot && queueQuery.data !== null && taskQueueChoices === null
        ? "The task queue could not be matched to this conversation."
        : null) ??
      (history.data !== null && !snapshot
        ? "The host returned an unsupported conversation format."
        : null),
    readState: snapshot?.agentId === agentId ? snapshot.readState : undefined,
    references: Object.fromEntries(
      [...validPages, ...(shownPage ? [shownPage] : [])].flatMap((page) =>
        Object.entries(page.references),
      ),
    ),
    revealMessage: (id: string) => loadWindow(id),
    showLatest: () => loadWindow(),
    hasNewer: anchored ? anchored.kind === "around" : Boolean(focusMessageId),
    loading: history.isPending,
    permission,
    act,
    markReadThrough,
    beginEdit,
    releaseEdit: (deliveryId: string, editId: string) =>
      write({
        environmentId,
        input: {
          hostId,
          request: { operation: "queue.edit", agentId, deliveryId, editId, action: "cancel" },
        },
      }).catch(() => null),
    send,
    sendSelection,
    branch,
    refresh,
    older,
    hasOlder: Boolean(cursor),
    snapshot: snapshot?.agentId === agentId ? snapshot : null,
    arrivalMessages: snapshot?.agentId === agentId ? snapshot.messages : [],
    messages,
    queueAttachmentChoices: taskId
      ? (taskQueueChoices ?? [])
      : queue?.agentId === agentId
        ? queue.deliveries.filter((delivery) => delivery.status === "queued")
        : [],
    queue: queue?.agentId === agentId ? queue : null,
  };
}
