import { taskQueueAttachmentChoices } from "@t3tools/client-runtime/openbot/queue-attachments";
import { selectableDraft, acceptedDraft } from "@t3tools/client-runtime/openbot/rich-conversation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { AppState } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { OpenbotPinnedThread, OpenbotThreadBranchResult } from "@t3tools/contracts";
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
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";
import { useGT } from "gt-react-native";

const decodePinnedThread = Schema.decodeUnknownOption(OpenbotPinnedThread);
const decodeThreadBranch = Schema.decodeUnknownOption(OpenbotThreadBranchResult);

export function useBotConversationPanel(
  environmentId: EnvironmentId,
  hostId: string,
  agentId: string,
  taskId: string | null,
  newId: () => string,
  watchActiveTurn = false,
  anchorMessageId?: string,
) {
  const gt = useGT();
  const [pages, setPages] = useState<readonly OpenbotConversationPage[]>([]);
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
        request: taskId
          ? anchorMessageId
            ? {
                operation: "conversation.pins.readThread",
                agentId,
                taskId,
                messageId: anchorMessageId,
                limit: 50,
              }
            : { operation: "task.read", agentId, taskId }
          : {
              operation: "conversation.page",
              agentId,
              anchor: anchorMessageId
                ? { type: "around", messageId: anchorMessageId }
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
  const latest = useMemo(() => botConversationPage(history.data), [history.data]);
  const snapshot = useMemo(() => {
    if (taskId && anchorMessageId) {
      const result = decodePinnedThread(history.data);
      return result._tag === "Some" && result.value.conversation.agentId === agentId
        ? result.value.conversation
        : null;
    }
    return latest ?? botConversationSnapshot(history.data);
  }, [latest, history.data, taskId, anchorMessageId, agentId]);
  const focused = useIsFocused();
  const refreshStreamingPage = useEffectEvent(() => {
    if (AppState.currentState === "active" && history.isSuccess && !history.isPending)
      history.refresh();
  });
  const activeTurnId = snapshot?.activeTurnId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Some linked hosts publish turn lifecycle events without forwarding text deltas. Read only the visible chat while its turn runs.
  useEffect(() => {
    if (!watchActiveTurn || !focused || !activeTurnId) return;
    const interval = setInterval(refreshStreamingPage, 350);
    return () => clearInterval(interval);
  }, [watchActiveTurn, focused, activeTurnId]);
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
        gt(
          "The host refused the change or the connection was lost. Retry or release an uncertain edit before starting another.",
        ),
      );
      return null;
    }
    refresh();
    return { value: settled.value.value };
  };
  const act = async (request: OpenbotWriteRequest) => (await execute(request)) !== null;
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
        gt(
          "The edit could not be confirmed. Retry its begin or release it before editing another message.",
        ),
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
  const send = async (committedText = text) => {
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
        setError(gt("Refresh Files to reconcile this draft before sending."));
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
        setError(gt("Refresh Files before selecting this batch."));
        return;
      }
      const attempt = fileAttempt ?? {
        id: ids[0]!,
        ids,
        text: draft.sendText ?? committedText,
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
          gt(
            "File acceptance is uncertain. Retry this same selection and original text, or reconcile in Files. Selection is not delivery.",
          ),
        );
      return;
    }
    if (!committedText.trim()) return;
    const key = JSON.stringify(["send", committedText, reply]);
    const clientMessageId = stableId(key);
    const ok = await act(
      taskId
        ? reply
          ? {
              operation: "thread.reply",
              agentId,
              taskId,
              text: committedText,
              replyToMessageId: reply,
              attachmentDraftIds: [],
              clientMessageId,
            }
          : { operation: "task.send", agentId, taskId, text: committedText, clientMessageId }
        : {
            operation: "conversation.send",
            agentId,
            text: committedText,
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
    const response = await execute({
      operation: "thread.branch",
      agentId,
      taskId,
      messageId,
      requestId: stableId(key),
    });
    if (!response) return null;
    const branch = decodeThreadBranch(response.value);
    if (
      branch._tag === "None" ||
      branch.value.branch.sourceTaskId !== taskId ||
      branch.value.branch.sourceMessageId !== messageId
    ) {
      setError(gt("The host has not confirmed this branch. Retry from the same message."));
      return null;
    }
    receipts.current.delete(key);
    return {
      id: branch.value.id,
      title: typeof branch.value.title === "string" ? branch.value.title : gt("Thread"),
    };
  };
  // A new latest revision invalidates cached older pages after reconnect or remote mutation.
  const validPages = latest ? pages.filter((page) => page.revision === latest.revision) : [];
  const cursor = validPages.length
    ? validPages.at(-1)!.pageInfo.olderCursor
    : latest?.pageInfo.olderCursor;
  const older = async () => {
    if (lock.current || !cursor || taskId || validPages.length >= 9) return;
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
            anchor: { type: "before", cursor },
            limit: 50,
          },
        },
      }),
    );
    if (settled._tag === "Failure" || settled.value._tag === "Failure") {
      setError(gt("Could not load older messages from the selected host."));
    } else {
      const value = botConversationPage(settled.value.value);
      if (
        value &&
        latest &&
        value.agentId === agentId &&
        value.threadId === latest.threadId &&
        value.revision === latest.revision
      )
        setPages([...validPages, value].slice(-9));
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
        ? gt("The task queue could not be matched to this conversation.")
        : null) ??
      (history.data !== null && !snapshot
        ? gt("The host returned an unsupported conversation format.")
        : null),
    references: latest?.references ?? {},
    loading: history.isPending,
    permission,
    act,
    sendVoice: async (spoken: string, clientMessageId: string) => {
      const payload = { agentId, text: spoken, clientMessageId };
      const receipt = await execute(
        taskId
          ? { operation: "task.send", taskId, ...payload }
          : { operation: "conversation.send", ...payload },
      );
      if (!receipt) return null;
      const value = receipt?.value;
      return value &&
        typeof value === "object" &&
        "messageId" in value &&
        typeof value.messageId === "string" &&
        value.messageId.length <= 512
        ? value.messageId
        : clientMessageId;
    },
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
    branch,
    refresh,
    older,
    hasOlder: Boolean(cursor) && validPages.length < 9,
    snapshot: snapshot?.agentId === agentId ? snapshot : null,
    messages: latest
      ? boundedBotMessages(agentId, latest.threadId, [...validPages].reverse().concat([latest]))
      : snapshot?.agentId === agentId
        ? snapshot.messages.slice(-500)
        : [],
    queueAttachmentChoices: taskId
      ? (taskQueueChoices ?? [])
      : queue?.agentId === agentId
        ? queue.deliveries.filter((delivery) => delivery.status === "queued")
        : [],
    queue: queue?.agentId === agentId ? queue : null,
  };
}
