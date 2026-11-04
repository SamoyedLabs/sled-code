import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotWriteRequest,
  OpenbotConversationPage,
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

export function useBotConversationPanel(
  environmentId: EnvironmentId,
  hostId: string,
  agentId: string,
  taskId: string | null,
  newId: () => string,
) {
  const [pages, setPages] = useState<readonly OpenbotConversationPage[]>([]);
  const [text, setText] = useState("");
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
          ? { operation: "task.read", agentId, taskId }
          : { operation: "conversation.page", agentId, anchor: { type: "latest" }, limit: 50 },
      },
    }),
  );
  const queueQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "queue.read", agentId } },
    }),
  );
  const latest = botConversationPage(history.data);
  const snapshot = latest ?? botConversationSnapshot(history.data);
  const queue = botQueueSnapshot(queueQuery.data);
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
        "The host refused the change or the connection was lost. Retry or release an uncertain edit before starting another.",
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
  const send = async () => {
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
      setError("Could not load older messages from the selected host.");
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
    text,
    setText,
    reply,
    setReply,
    busy,
    error:
      error ??
      history.error ??
      queueQuery.error ??
      (history.data !== null && !snapshot
        ? "The host returned an unsupported conversation format."
        : null),
    references: latest?.references ?? {},
    loading: history.isPending,
    permission,
    act,
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
    queue: queue?.agentId === agentId ? queue : null,
  };
}
