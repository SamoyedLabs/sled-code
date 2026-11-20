import * as Schema from "effect/Schema";
import { OpenbotChannelPresentations } from "@t3tools/contracts";
import { useRef, useState } from "react";
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
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";

const decodePresentations = Schema.decodeUnknownOption(OpenbotChannelPresentations);
export function useBotChannels(
  environmentId: EnvironmentId,
  hostId: string,
  newId: () => string,
  initialChannelId?: string,
  initialCreate = false,
) {
  const [selected, setSelected] = useState<string | null>(initialChannelId ?? null);
  const [edit, setEdit] = useState<ChannelEdit | null>(() =>
    initialCreate ? channelNewDraft(newId()) : null,
  );
  const [pages, setPages] = useState<readonly OpenbotChannelPage[]>([]);
  const [around, setAround] = useState<OpenbotChannelPage | null>(null);
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
  const presentationQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.presentation" } },
    }),
  );
  const decodedPresentation = decodePresentations(presentationQuery.data);
  const presentation =
    decodedPresentation._tag === "Some"
      ? decodedPresentation.value.find((item) => item.channelId === selected)
      : undefined;
  const latest = channelPage(pageQuery.data);
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
    presentationQuery.refresh();
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
  const markReadThrough = async (throughSequence: number) => {
    if (!selected) return false;
    const request = channelAdminRequest(
      { operation: "channel.markRead", channelId: selected, throughSequence },
      newId(),
    );
    if (!request) return false;
    const result = await settlePromise(() => admin({ environmentId, input: { hostId, request } }));
    if (result._tag === "Failure" || result.value._tag === "Failure") {
      setError("Could not update the read status. Use Mark read to retry.");
      return false;
    }
    listQuery.refresh();
    pageQuery.refresh();
    presentationQuery.refresh();
    return true;
  };
  const olderCursor = pages.length
    ? pages.at(-1)!.olderCursor
    : ((around ?? latest)?.olderCursor ?? null);
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
    presentation,
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
    messages: selected
      ? channelMessages(selected, [...pages, ...((around ?? latest) ? [around ?? latest!] : [])])
      : [],
    tasks: latest?.tasks ?? [],
    throughSequence: latest?.throughSequence ?? 0,
    olderCursor,
    older,
    hasNewer: around !== null,
    showLatest: () => {
      setAround(null);
      setPages([]);
    },
    revealUnread: async () => {
      if (lock.current || !selected || presentation?.firstUnreadSequence == null) return false;
      lock.current = true;
      setBusy(true);
      try {
        const result = await read({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "channel.read",
              channelId: selected,
              beforeSequence: presentation.firstUnreadSequence + 100,
            },
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        const value = channelPage(result.value);
        if (
          !value ||
          value.channel.id !== selected ||
          !value.messages.some((item) => item.id === presentation.firstUnreadMessageId)
        )
          return false;
        setPages([]);
        setAround(value);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not find the unread message.");
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    canManage,
    canSettings,
    canOperate,
    busy,
    act,
    markReadThrough,
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
      setAround(null);
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
    send: () => {
      if (selected && text.trim())
        void act({
          operation: "channel.send",
          channelId: selected,
          text: text.trim(),
          recipientAgentId: recipient,
          replyToMessageId: reply,
          attachmentDraftIds: [],
        });
    },
  };
}
