import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotChannelPage } from "@t3tools/contracts";
import {
  workflowAgents,
  channelList,
  channelPage,
  channelMessages,
  channelNewDraft,
  channelEditDraft,
  channelSaveRequest,
  channelAdminRequest,
  channelDraftConflict,
  type ChannelActionInput,
  type ChannelEdit,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotChannels(
  environmentId: EnvironmentId,
  hostId: string,
  newId: () => string,
  initialChannelId?: string,
  options?: {
    createOnOpen?: boolean;
    onCreated?: (channelId: string, name: string) => void;
    watchActiveTasks?: boolean;
  },
) {
  const [selected, setSelected] = useState<string | null>(initialChannelId ?? null);
  const [edit, setEdit] = useState<ChannelEdit | null>(() =>
    options?.createOnOpen ? channelNewDraft(newId()) : null,
  );
  const [pages, setPages] = useState<readonly OpenbotChannelPage[]>([]);
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const receipts = useRef(new Map<string, string>());
  const listQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.list" } },
    }),
  );
  const pageQuery = useEnvironmentQuery(
    selected
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "channel.read", channelId: selected } },
        })
      : null,
  );
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const latest = useMemo(() => channelPage(pageQuery.data), [pageQuery.data]);
  const messages = useMemo(
    () => selected ? channelMessages(selected, [...pages, ...(latest ? [latest] : [])]) : [],
    [selected, pages, latest],
  );
  const activeTaskIds = useMemo(
    () =>
      new Set(
        latest?.tasks
          .filter((task) => task.state === "queued" || task.state === "running")
          .map((task) => task.id),
      ),
    [latest?.tasks],
  );
  const hasActiveTasks = activeTaskIds.size > 0;
  const refreshActivePage = useEffectEvent(() => {
    if (AppState.currentState === "active" && pageQuery.isSuccess && !pageQuery.isPending)
      pageQuery.refresh();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the focused group page while its host has active tasks, since the link can omit text deltas.
  useEffect(() => {
    if (!selected || !options?.watchActiveTasks || !hasActiveTasks) return;
    const timer = setInterval(refreshActivePage, 350);
    return () => clearInterval(timer);
  }, [selected, options?.watchActiveTasks, hasActiveTasks]);
  const canSettings = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "channel.save",
        channelId: selected ?? "permission",
        operationId: "permission",
        update: true,
        draft: { name: "Permission", title: "", instructions: "", members: [], leadAgentId: null },
      },
    }),
  );
  const canOperate = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "channel.send",
        channelId: selected ?? "permission",
        operationId: "permission",
        text: "permission",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const refresh = () => {
    listQuery.refresh();
    pageQuery.refresh();
    agentsQuery.refresh();
  };
  const act = async (input: ChannelActionInput) => {
    if (lock.current) return;
    const key = JSON.stringify(input);
    const id = receipts.current.get(key) ?? newId();
    receipts.current.set(key, id);
    const request = channelAdminRequest(input, id);
    if (!request) {
      setError("Complete the channel settings before continuing.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await admin({ environmentId, input: { hostId, request } }).catch(() => null);
    if (!result) setError("The channel request could not complete. Retry the same action.");
    else if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      receipts.current.delete(key);
      if (request.operation === "channel.save") {
        setSelected(request.channelId);
        setEdit(null);
        if (!request.update) options?.onCreated?.(request.channelId, request.draft.name);
      } else if (request.operation === "channel.send") {
        setText("");
        setReply(null);
      } else if (request.operation === "channel.restore")
        setNotice("Channel restored. Paused tasks can be resumed individually.");
      else if (request.operation === "channel.delete") {
        setSelected(null);
        setEdit(null);
        setPages([]);
      }
      refresh();
    }
    setBusy(false);
    lock.current = false;
  };
  const olderCursor = pages.length ? pages.at(-1)!.olderCursor : (latest?.olderCursor ?? null);
  const older = async () => {
    if (lock.current || !selected || olderCursor === null) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await read({
      environmentId,
      input: {
        hostId,
        request: { operation: "channel.read", channelId: selected, beforeSequence: olderCursor },
      },
    }).catch(() => null);
    if (!result) setError("Could not load older channel messages.");
    else if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      const value = channelPage(result.value);
      if (value?.channel.id === selected) setPages((previous) => [...previous, value]);
      else setError("The engine returned an unsupported channel history page.");
    }
    setBusy(false);
    lock.current = false;
  };
  return {
    selected,
    edit,
    setEdit,
    text,
    setText,
    recipient,
    setRecipient,
    reply,
    setReply,
    channels: channelList(listQuery.data),
    agents: workflowAgents(agentsQuery.data),
    channel: latest?.channel ?? null,
    messages,
    tasks: latest?.tasks ?? [],
    activeTaskIds,
    throughSequence: latest?.throughSequence ?? 0,
    olderCursor,
    older,
    canManage,
    canSettings,
    canOperate,
    busy,
    act,
    notice,
    loading: listQuery.isPending || pageQuery.isPending,
    error: error ?? listQuery.error ?? pageQuery.error,
    conflict: edit?.update ? channelDraftConflict(edit, latest?.channel ?? null) : false,
    refresh: () => {
      setPages([]);
      refresh();
    },
    select: (channelId: string) => {
      setSelected(channelId);
      setPages([]);
      setEdit(null);
      setText("");
      setRecipient(null);
      setReply(null);
      setError(null);
      setNotice(null);
    },
    create: () => {
      setSelected(null);
      setPages([]);
      setEdit(channelNewDraft(newId()));
      setText("");
      setReply(null);
      setRecipient(null);
    },
    editSettings: () => {
      if (latest) setEdit(channelEditDraft(latest.channel));
    },
    save: () => {
      if (edit) {
        const request = channelSaveRequest(edit, "validation", latest?.channel ?? null);
        if (request) {
          const { operationId: _operationId, ...input } = request;
          void act(input);
        } else
          setError(
            "Channel settings changed or are incomplete. Review the current settings before saving.",
          );
      }
    },
    send: async (committedText = text) => {
      if (selected && committedText.trim())
        await act({
          operation: "channel.send",
          channelId: selected,
          text: committedText.trim(),
          recipientAgentId: recipient,
          replyToMessageId: reply,
          attachmentDraftIds: [],
        });
    },
    sendVoice: async (spoken: string, operationId: string) => {
      if (lock.current || !selected || !canOperate || !spoken.trim()) return null;
      lock.current = true;
      setBusy(true);
      setError(null);
      return (async () => {
        const result = await admin({
          environmentId,
          input: { hostId, request: {
            operation: "channel.send",
            channelId: selected,
            operationId,
            includeReceipt: true,
            text: spoken.trim(),
            recipientAgentId: recipient,
            replyToMessageId: null,
            attachmentDraftIds: [],
          } },
        });
        refresh();
        const value = result._tag === "Success" ? result.value : null;
        return value && typeof value === "object" &&
          "acceptedOperationId" in value && value.acceptedOperationId === operationId &&
          "acceptedMessageId" in value && typeof value.acceptedMessageId === "string"
          ? value.acceptedMessageId : null;
      })().finally(() => {
        setBusy(false);
        lock.current = false;
      });
    },
    stopVoice: async (taskId: string) => {
      if (!selected || !canOperate || lock.current) return false;
      const result = await admin({
        environmentId,
        input: { hostId, request: {
          operation: "channel.stop", channelId: selected, operationId: newId(), taskId, recipientAgentId: null,
        } },
      });
      refresh();
      return result._tag === "Success";
    },
  };
}
