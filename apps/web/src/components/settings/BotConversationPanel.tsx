import {
  BotMessageComposer,
  BotComposerInput,
  BotComposerFooter,
  BotComposerSend,
  BotComposerVoice,
  BotComposerVoiceStatus,
} from "./BotMessageComposer";
import { ComposerControl } from "../chat/ComposerControl";
import { SourceModelPicker } from "../bots/SourceProviderEnvironment";
import {
  SourceChatScrollRail,
  UnreadMessagesBanner,
  UnreadMessagesDivider,
  ScrollToLatestButton,
  useNewMessageTally,
  type ChatScrollSection,
} from "../bots/upstream/conversation/SourceChatNavigation";
import { useSourceChatVirtualizer } from "../bots/upstream/conversation/useSourceChatVirtualizer";
import { useBotAutoRead } from "../bots/upstream/conversation/useBotAutoRead";
/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-restyle -- Source-faithful OpenBot classes are defined in the imported bot-conversation.css, scoped to this feature. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  FileIcon,
  ImageIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PuzzleIcon,
  XIcon,
} from "lucide-react";
import type { EnvironmentId, OpenbotAgent } from "@t3tools/contracts";
import { resolveBotQuotedFileSource } from "@t3tools/client-runtime/openbot/presentation";
import { botMessageSections } from "@t3tools/client-runtime/openbot/presentation";
import { BotFilePreview, type BotQuotedFilePreview } from "../bots/BotFilePreview";
import { watchBotQuotedText } from "../bots/upstream/conversation/quotedText";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { readPreparedConnection } from "../../state/session";
import { BotMessageFiles } from "../bots/BotMessageFiles";
import { BotFileSelectionContext, usePublishBotFileSelection } from "./BotFileSelectionContext";
import { botFileQuoteTarget } from "./botSelectionModel";
import { BotSelectionActions } from "./BotSelectionActions";
import { BotComposerAttachments } from "./BotComposerAttachments";
import { useBotComposerUploads } from "./useBotComposerUploads";
import { BotStreamingMessage } from "./BotStreamingMessage";
import { useBotDictation } from "./BotDictation";
import { BotResponseBlock } from "./BotResponseBlock";
import { BotDeferredMessageDetail } from "./BotDeferredMessageDetail";
import { useBotConversationPanel } from "./useBotConversationPanel";
import { BotConversationQueue } from "./BotConversationQueue";
import { cn, randomUUID } from "../../lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { namedClipboardTarget, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { BotComposerEditor, type BotComposerEditorHandle } from "./BotComposerEditor";
import { BotToolActivity } from "../bots/BotToolActivity";
import { SourceAgentAvatar } from "../bots/SourceAgentAvatar";
import { BotTypingIndicator } from "../bots/BotTypingIndicator";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { MenuPopup } from "../bots/upstream/OpenbotMenu";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { requestConfirmDialog } from "../../confirmDialog";
import "./bot-conversation.css";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  taskId?: string | null;
  workspace?: boolean;
  agentName?: string;
  agent?: typeof OpenbotAgent.Type;
  composerAccessory?: ReactNode;
  publishFileSelection?: boolean;
  onOpenFiles?: () => void;
  onOpenQuotedFile?: ((preview: BotQuotedFilePreview) => void) | undefined;
  initialDraft?: string;
  focusMessageId?: string;
  onDraftChange?: (text: string) => void;
};

function clearBotQuoteWatcher(ref: { current: { release: (() => void) | undefined } }) {
  ref.current.release?.();
  ref.current.release = undefined;
}

// React translation of OpenBot ConversationComposer, ChatMessageRow and MessageActions.
// The host controller remains the authority for identities, permissions and delivery receipts.
export function BotConversationPanel(props: Props) {
  return (
    <ConversationBody
      key={JSON.stringify([
        props.environmentId,
        props.hostId,
        props.agentId,
        props.taskId,
        props.focusMessageId,
      ])}
      {...props}
    />
  );
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
function timestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  return (date.toDateString() === today.toDateString() ? timeFormatter : dateTimeFormatter).format(
    date,
  );
}

function ConversationBody({
  environmentId,
  hostId,
  agentId,
  taskId = null,
  workspace = false,
  agentName,
  agent,
  composerAccessory,
  publishFileSelection = false,
  onOpenFiles,
  onOpenQuotedFile,
  initialDraft,
  onDraftChange,
  focusMessageId,
}: Props) {
  const c = useBotConversationPanel(
    environmentId,
    hostId,
    agentId,
    taskId,
    randomUUID,
    focusMessageId,
  );
  const [draftReady, setDraftReady] = useState(false);
  const publishDraft = useStableCallback((text: string) => onDraftChange?.(text));
  // Both states belong to this keyed component. Initialize before committing so an empty
  // controller draft can never overwrite the workspace cache or flash in the editor.
  if (!draftReady) {
    c.setText(initialDraft ?? "");
    setDraftReady(true);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Publish controller changes to the workspace draft cache, including a successful send clearing its text; the restore gate prevents publishing the initial empty controller state.
  useEffect(() => {
    if (draftReady) publishDraft(c.text);
  }, [c.text, draftReady, publishDraft]);
  const [title, setTitle] = useState("");
  const [panel, setPanel] = useState<"files" | "queue" | "thread" | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [expandedReactions, setExpandedReactions] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const voice = useBotDictation(
    JSON.stringify(["bot", environmentId, hostId, agentId, taskId]),
    c.text,
    c.setText,
  );
  const disabled = c.busy || !c.permission;
  const scroller = useRef<HTMLOListElement>(null);
  const editor = useRef<BotComposerEditorHandle>(null);
  const followLatest = useRef(!focusMessageId);
  const [awayFromLatest, setAwayFromLatest] = useState(Boolean(focusMessageId));
  const tally = useNewMessageTally(
    c.arrivalMessages.map((message) => ({
      id: message.id,
      countable:
        message.author !== "user" &&
        Boolean(
          message.text.trim() ||
          (Array.isArray(message.attachments) && message.attachments.length) ||
          message.questionPrompt ||
          message.uiBlock ||
          message.imageGeneration,
        ) &&
        !["reasoning", "plan", "subagents", "memory-changes", "routine-quiet-answer"].includes(
          message.itemType ?? "",
        ),
    })),
    !awayFromLatest,
  );
  const [jumpTarget, setJumpTarget] = useState<string | null>(focusMessageId ?? null);
  const jumped = useRef<string | null>(null);
  const firstUnread = c.readState?.firstUnreadMessageId;
  const jumpToMessage = async (id: string) => {
    followLatest.current = false;
    jumped.current = null;
    setJumpTarget(id);
    if (!c.messages.some((message) => message.id === id)) await c.revealMessage(id);
  };
  const markReadThrough = (through: string | undefined) => {
    if (!through) return;
    void c.markReadThrough(through);
  };
  const markRead = () => markReadThrough(c.messages.at(-1)?.id);
  useBotAutoRead({
    identity: JSON.stringify([environmentId, hostId, agentId, taskId]),
    scroller,
    watermark: c.messages.at(-1)?.id ?? null,
    unread: c.readState?.unreadCount ?? 0,
    enabled:
      c.permission &&
      !c.busy &&
      !c.loading &&
      !c.hasNewer &&
      c.messages.at(-1)?.status !== "streaming",
    onRead: markReadThrough,
  });
  const showLatest = async () => {
    clearBotQuoteWatcher(releaseQuote);
    if (c.hasNewer) await c.showLatest();
    followLatest.current = true;
    setAwayFromLatest(false);
    tally.dismiss();
    requestAnimationFrame(() => virtual.scrollToEnd());
  };

  const virtualRoot = useRef<HTMLOListElement>(null);
  const virtual = useSourceChatVirtualizer<HTMLOListElement, HTMLLIElement>(
    scroller,
    virtualRoot,
    c.messages.map((message) => message.id),
    followLatest,
  );
  const focusedMessage = useRef<string | null>(null);
  const lastMessage = c.messages.at(-1);
  const messageLayout = lastMessage
    ? `${c.messages.length}:${lastMessage.id}:${lastMessage.text.length}`
    : null;
  const selectedFiles = c.selectedDraftIds.flatMap((id) => {
    const file = c.fileDrafts.find((draft) => draft.attachment.id === id);
    return file ? [file] : [];
  });
  const uploads = useBotComposerUploads({
    environmentId,
    hostId,
    agentId,
    taskId,
    threadId: c.snapshot?.threadId ?? undefined,
    disabled: c.busy || Boolean(c.fileAttempt),
    selectedCount: c.selectedDraftIds.length,
    onReady: (id, beforeId) => {
      c.addDrafts([id], beforeId);
      c.refreshDrafts();
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const stop =
    Boolean(c.snapshot?.activeTurnId) &&
    !c.text.trim() &&
    !c.selectedDraftId &&
    uploads.uploads.length === 0;
  const activeTurn = c.snapshot?.activeTurnId;
  const awaitingReply =
    Boolean(activeTurn) &&
    !c.snapshot?.messages.some(
      (message) =>
        message.author !== "user" &&
        (message.turnId === activeTurn || message.status === "streaming") &&
        (message.text.trim() || message.uiBlock),
    );
  const detailsMessage = c.messages.find((message) => message.id === detailsId);
  const replyMessage =
    c.messages.find((message) => message.id === c.reply) ??
    (c.reply ? c.references[c.reply] : undefined);
  const queuedCount =
    c.queue?.deliveries.filter((delivery) => delivery.status === "queued").length ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the DOM viewport at the latest message unless the reader scrolled away; preserve its anchor when history is prepended.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !messageLayout) return;
    if (focusMessageId && focusedMessage.current !== focusMessageId) {
      const target = node.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(focusMessageId)}"]`,
      );
      if (target) {
        target.scrollIntoView({ block: "center" });
        focusedMessage.current = focusMessageId;
      }
    } else if (followLatest.current) node.scrollTop = node.scrollHeight;
  }, [messageLayout, focusMessageId]);

  const railSections: ChatScrollSection[] = c.messages.flatMap((message, row) =>
    message.author === "user" && message.text.trim()
      ? [
          {
            key: message.id,
            label: message.text.replace(/\s+/g, " ").slice(0, 160),
            row,
            start: virtual.virtualized ? virtual.instance.measurementsCache[row]?.start : undefined,
          },
        ]
      : [],
  );
  const shownSections = c.hasOlder
    ? [{ key: "", label: "Earlier messages", start: 0 }, ...railSections]
    : railSections;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Around-page navigation must reveal its original row after the new virtualized range commits, including a quote outside the mounted viewport.
  useLayoutEffect(() => {
    if (!jumpTarget || jumped.current === jumpTarget) return;
    const index = c.messages.findIndex((message) => message.id === jumpTarget);
    if (index < 0) return;
    virtual.instance.scrollToIndex(index, { align: "start" });
    jumped.current = jumpTarget;
  }, [jumpTarget, c.messages, virtual.instance]);

  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const quoteRequest = useRef(0);
  const releaseQuote = useRef<{ release: (() => void) | undefined }>({ release: undefined });
  const [localQuotedFile, setLocalQuotedFile] = useState<BotQuotedFilePreview | null>(null);
  const openQuote = async (id: string, text: string) => {
    const root = scroller.current;
    if (!root) return;
    const request = ++quoteRequest.current;
    clearBotQuoteWatcher(releaseQuote);
    setCopyError(null);
    const target = botFileQuoteTarget(id);
    if (!target) {
      followLatest.current = false;
      releaseQuote.current.release = watchBotQuotedText(
        root,
        `[data-selection-message-id="${CSS.escape(id)}"]`,
        text,
      );
      await jumpToMessage(id);
      return;
    }
    const connection = readPreparedConnection(environmentId);
    if (!connection) return;
    const source = resolveBotQuotedFileSource(
      target,
      [...c.messages, ...Object.values(c.references)],
      taskId,
    );
    if (!source) {
      setCopyError("The quoted attachment is unavailable in this conversation.");
      return;
    }
    const settled = await settlePromise(async () => {
      const result = await materialize({ environmentId, input: { hostId, agentId, source } });
      if (request !== quoteRequest.current || readPreparedConnection(environmentId) !== connection)
        return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const preview = { file: result.value, target, text };
      if (onOpenQuotedFile) onOpenQuotedFile(preview);
      else setLocalQuotedFile(preview);
    });
    if (settled._tag === "Failure" && request === quoteRequest.current) {
      const cause = squashAtomCommandFailure(settled);
      setCopyError(cause instanceof Error ? cause.message : "The quoted file could not be opened.");
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel quote observers and reject late file reads when this identity-scoped chat leaves the workspace.
  useEffect(
    () => () => {
      quoteRequest.current += 1;
      clearBotQuoteWatcher(releaseQuote);
    },
    [releaseQuote],
  );

  const openMessageQuote = useStableCallback((id: string, text: string) => {
    void openQuote(id, text);
  });
  const followMessageLayout = useStableCallback(() => {
    const node = scroller.current;
    if (node && followLatest.current) node.scrollTop = node.scrollHeight;
  });

  const fileSelection = {
    disabled: !c.permission || Boolean(c.fileAttempt) || voice.busy,
    onSend: c.sendSelection,
    onQuote: (id: string, text: string) => {
      if (editor.current?.insertQuote(id, text)) {
        if (!botFileQuoteTarget(id)) c.setReply(id);
        setCopyError(null);
      } else setCopyError("This quote would exceed the message length limit.");
    },
  };
  usePublishBotFileSelection(publishFileSelection, fileSelection);

  const stopTurn = () => {
    if (!c.snapshot?.activeTurnId) return;
    void c.act(
      taskId
        ? { operation: "task.stop", agentId, taskId }
        : { operation: "conversation.stop", agentId, turnId: c.snapshot.activeTurnId },
    );
  };

  return (
    <BotFileSelectionContext value={fileSelection}>
      <section
        aria-label="Bot conversation"
        className={cn("ob-chat", composerAccessory && "[--conversation-column-width:800px]!")}
        data-workspace={workspace || undefined}
      >
        <div className="ob-chat-utilities">
          {queuedCount > 0 && (
            <button type="button" className="ob-chat-queue-label" onClick={() => setPanel("queue")}>
              <ListIcon />
              {queuedCount} queued
            </button>
          )}
          <Menu>
            <MenuTrigger className="ob-chat-action-button" aria-label="Conversation actions">
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup className="ob-chat-menu" align="end">
              <MenuItem onClick={c.refresh}>Refresh conversation</MenuItem>
              <MenuItem onClick={() => setPanel("queue")}>Queue</MenuItem>
              {taskId && <MenuItem onClick={() => setPanel("thread")}>Thread settings</MenuItem>}
              {c.messages.length > 0 && (
                <MenuItem
                  disabled={disabled}
                  onClick={() => {
                    const throughMessageId = c.messages.at(-1)!.id;
                    void c.act(
                      taskId
                        ? { operation: "thread.markRead", agentId, taskId, throughMessageId }
                        : { operation: "conversation.markRead", agentId, throughMessageId },
                    );
                  }}
                >
                  Mark read
                </MenuItem>
              )}
              {!taskId && (
                <MenuItem
                  disabled={disabled}
                  onClick={() => void c.act({ operation: "conversation.markUnread", agentId })}
                >
                  Mark unread
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        </div>
        {localQuotedFile && (
          <BotFilePreview
            name={localQuotedFile.file.name}
            mimeType={localQuotedFile.file.mimeType}
            sizeBytes={localQuotedFile.file.size}
            asset={{ environmentId, attachmentId: localQuotedFile.file.attachmentId }}
            quoteTarget={localQuotedFile.target}
            revealText={localQuotedFile.text}
            onClose={() => setLocalQuotedFile(null)}
          />
        )}
        <BotSelectionActions
          root={scroller}
          disabled={fileSelection.disabled}
          onSend={fileSelection.onSend}
          onQuote={fileSelection.onQuote}
        />
        <UnreadMessagesBanner
          count={c.readState?.unreadCount ?? 0}
          busy={c.busy}
          onRead={markRead}
          onJump={() => {
            if (firstUnread) void jumpToMessage(firstUnread);
          }}
        />
        <ol
          ref={scroller}
          className={cn("ob-chat-scroll", composerAccessory && "pt-6! pb-8!")}
          onScroll={(event) => {
            const node = event.currentTarget;
            followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            setAwayFromLatest(!followLatest.current);
            if (followLatest.current && tally.count) tally.dismiss();
          }}
        >
          <SourceChatScrollRail
            as="li"
            scroller={scroller}
            sections={shownSections}
            onJump={(section) => {
              followLatest.current = false;
              if (section.row === undefined) void c.older();
              else
                virtual.instance.scrollToIndex(section.row, {
                  align: "start",
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
                });
            }}
          />
          {c.hasOlder && (
            <li className="ob-chat-history-status">
              <Button
                variant="ghost"
                size="sm"
                disabled={c.busy}
                onClick={() => {
                  const anchor = c.messages[0]?.id;
                  followLatest.current = false;
                  void c.older().then(() => {
                    if (anchor) {
                      jumped.current = null;
                      setJumpTarget(anchor);
                    }
                  });
                }}
              >
                Load older messages
              </Button>
            </li>
          )}
          {c.loading && (
            <li className="ob-chat-history-status" role="status">
              Loading conversation…
            </li>
          )}
          <li role="presentation" style={{ listStyle: "none" }}>
            <ol
              ref={virtualRoot}
              className="virtual-chat-list"
              style={{
                position: "relative",
                height: virtual.virtualized ? virtual.total : "auto",
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {virtual.items.map((item) => {
                const message = c.messages[item.index];
                if (!message) return null;
                return (
                  <li
                    key={message.id}
                    data-index={item.index}
                    ref={virtual.instance.measureElement}
                    style={{
                      position: virtual.virtualized ? "absolute" : "relative",
                      top: virtual.virtualized ? 0 : undefined,
                      width: "100%",
                      transform: virtual.virtualized
                        ? `translateY(${item.start - virtual.margin}px)`
                        : undefined,
                    }}
                    data-message-id={message.id}
                    className={cn("ob-chat-message", composerAccessory && "pt-5!")}
                    data-author={message.author === "user" ? "user" : "agent"}
                  >
                    {message.id === firstUnread && <UnreadMessagesDivider />}
                    {workspace && message.author !== "user" && agent && (
                      <span className="ob-live-message-avatar">
                        <SourceAgentAvatar agent={agent} size={32} />
                      </span>
                    )}
                    {message.author !== "user" && agentName && (
                      <div className="ob-live-message-author">{agentName}</div>
                    )}
                    {message.senderMember && !agentName && (
                      <div className="ob-chat-author">{message.senderMember.name}</div>
                    )}
                    <div className="ob-chat-message-shell">
                      <div
                        className={cn(
                          "ob-chat-bubble",
                          composerAccessory && "max-w-[85%]!",
                          composerAccessory && message.author === "user" && "max-w-[80%]!",
                        )}
                      >
                        {message.author !== "user" && (
                          <BotToolActivity
                            trace={message.trace}
                            streaming={message.status === "streaming"}
                            deferred={
                              message.deferredFields?.includes("trace")
                                ? { environmentId, hostId, agentId, taskId, messageId: message.id }
                                : undefined
                            }
                          />
                        )}
                        {(message.text ||
                          message.replyToMessageId ||
                          message.status === "streaming") && (
                          <div
                            className={cn(
                              "ob-chat-bubble-content",
                              composerAccessory &&
                                "rounded-2xl! px-3! py-2.5! text-sm! leading-relaxed! tracking-normal!",
                              composerAccessory &&
                                (message.author === "user"
                                  ? "border-transparent! bg-primary! text-primary-foreground!"
                                  : "border-border/60! bg-card!"),
                            )}
                          >
                            {message.replyToMessageId && (
                              <button
                                type="button"
                                className="ob-chat-reply-quote"
                                aria-label="Show replied message"
                                onClick={() => {
                                  const id = message.replyToMessageId;
                                  if (!id) return;
                                  const referenced =
                                    c.messages.find((entry) => entry.id === id) ?? c.references[id];
                                  void openQuote(id, referenced?.text ?? "");
                                }}
                              >
                                {(
                                  c.messages.find((m) => m.id === message.replyToMessageId) ??
                                  c.references[message.replyToMessageId]
                                )?.text.slice(0, 200) ?? "Earlier message"}
                              </button>
                            )}
                            {!message.text && message.status === "streaming" && (
                              <BotTypingIndicator label={`${agentName ?? "Bot"} is typing`} />
                            )}
                            {message.text && (
                              <BotStreamingMessage
                                selectionMessageId={
                                  message.status === "streaming" ? undefined : message.id
                                }
                                selectionInstruction={
                                  message.author === "user" && Boolean(message.replyToMessageId)
                                }
                                onOpenQuote={openMessageQuote}
                                environmentId={environmentId}
                                hostId={hostId}
                                agentId={agentId}
                                text={message.text}
                                isStreaming={message.status === "streaming"}
                                className="ob-chat-markdown"
                                onLayout={followMessageLayout}
                              />
                            )}
                          </div>
                        )}
                        {message.deferredFields?.includes("text") && (
                          <BotDeferredMessageDetail
                            environmentId={environmentId}
                            hostId={hostId}
                            agentId={agentId}
                            taskId={taskId}
                            messageId={message.id}
                            field="text"
                          />
                        )}
                        <BotMessageFiles
                          environmentId={environmentId}
                          hostId={hostId}
                          agentId={agentId}
                          taskId={taskId}
                          messageId={message.id}
                          attachments={message.attachments}
                        />
                        <BotResponseBlock
                          key={JSON.stringify([message.id, message.uiBlock])}
                          environmentId={environmentId}
                          hostId={hostId}
                          message={message}
                          snapshot={c.snapshot}
                          taskId={taskId}
                          disabled={disabled}
                          respond={c.act}
                        />
                      </div>
                    </div>
                    {typeof message.reaction === "string" && message.reaction && (
                      <div className="ob-chat-reaction-pill">{message.reaction}</div>
                    )}
                    <div className="ob-chat-action-row">
                      <div
                        className="ob-chat-message-actions"
                        role="toolbar"
                        aria-label="Message actions"
                      >
                        <button
                          type="button"
                          className="ob-chat-action-button"
                          aria-label={copiedId === message.id ? "Copied" : "Copy message"}
                          onClick={() => {
                            void writeTextToClipboard(
                              message.text,
                              namedClipboardTarget("message"),
                            ).then(
                              () => {
                                setCopiedId(message.id);
                                setCopyError(null);
                              },
                              () => setCopyError("Could not copy this message."),
                            );
                          }}
                        >
                          {copiedId === message.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                        {!taskId && (
                          <Menu>
                            <MenuTrigger
                              className="ob-chat-action-button"
                              aria-label="Add reaction"
                              disabled={disabled}
                            >
                              <MessageGlyph kind="reaction" />
                            </MenuTrigger>
                            <MenuPopup className="ob-chat-menu" align="start" sideOffset={6}>
                              <div className="ob-chat-reactions">
                                {["👍", "👎", "❤️", "😂", "🎉", "😮"].map((emoji) => (
                                  <MenuItem
                                    key={emoji}
                                    aria-label={`React ${emoji}`}
                                    onClick={() =>
                                      void c.act({
                                        operation: "conversation.react",
                                        agentId,
                                        messageId: message.id,
                                        emoji: message.reaction === emoji ? null : emoji,
                                      })
                                    }
                                  >
                                    {emoji}
                                  </MenuItem>
                                ))}
                                <MenuItem
                                  closeOnClick={false}
                                  aria-label="More emoji"
                                  onClick={() => setExpandedReactions(message.id)}
                                >
                                  <PlusIcon />
                                </MenuItem>
                              </div>
                              {expandedReactions === message.id && (
                                <div className="ob-chat-reactions ob-chat-reactions-more">
                                  {["🔥", "👏", "🙏", "🤔", "👀", "✅", "🚀", "💯"].map((emoji) => (
                                    <MenuItem
                                      key={emoji}
                                      aria-label={`React ${emoji}`}
                                      onClick={() =>
                                        void c.act({
                                          operation: "conversation.react",
                                          agentId,
                                          messageId: message.id,
                                          emoji: message.reaction === emoji ? null : emoji,
                                        })
                                      }
                                    >
                                      {emoji}
                                    </MenuItem>
                                  ))}
                                </div>
                              )}
                              <MenuItem
                                onClick={() =>
                                  void c.act({
                                    operation: "conversation.react",
                                    agentId,
                                    messageId: message.id,
                                    emoji: null,
                                  })
                                }
                              >
                                Clear reaction
                              </MenuItem>
                            </MenuPopup>
                          </Menu>
                        )}
                        <button
                          type="button"
                          className="ob-chat-action-button"
                          aria-label="Reply"
                          disabled={disabled || Boolean(c.fileAttempt)}
                          onClick={() => {
                            c.setReply(message.id);
                            editor.current?.focus();
                          }}
                        >
                          <MessageGlyph kind="reply" />
                        </button>
                        {(message.author === "assistant" || message.author === "agent") && (
                          <button
                            type="button"
                            className="ob-chat-action-button"
                            aria-label="Branch here"
                            disabled={
                              disabled ||
                              message.status === "streaming" ||
                              Boolean(c.snapshot?.activeTurnId)
                            }
                            onClick={() => void c.branch(message.id)}
                          >
                            <MessageGlyph kind="branch" />
                          </button>
                        )}
                        <Menu>
                          <MenuTrigger
                            className="ob-chat-action-button"
                            aria-label="More message actions"
                          >
                            <MoreHorizontalIcon />
                          </MenuTrigger>
                          <MenuPopup className="ob-chat-menu" align="start">
                            <MenuItem onClick={() => setDetailsId(message.id)}>
                              Message details
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                      <time className="ob-chat-message-time" dateTime={message.createdAt}>
                        {timestamp(message.createdAt)}
                      </time>
                      {(message.status === "failed" || message.status === "interrupted") && (
                        <span className="ob-chat-message-status">
                          {message.status === "failed" ? "Failed" : "Interrupted"}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </li>
          {workspace &&
            awaitingReply &&
            !c.messages.some((message) => message.status === "streaming") && (
              <li className="ob-chat-message ob-live-typing" data-author="agent">
                {agent && (
                  <span className="ob-live-message-avatar">
                    <SourceAgentAvatar agent={agent} size={32} />
                  </span>
                )}
                <div className="ob-live-message-author">{agentName ?? "Bot"}</div>
                <div className="ob-chat-bubble-content">
                  <BotTypingIndicator label={`${agentName ?? "Bot"} is typing`} />
                </div>
              </li>
            )}
        </ol>
        <div className={cn("ob-chat-composer-wrap", composerAccessory && "pb-5! px-6!")}>
          {(awayFromLatest || c.hasNewer || tally.count > 0) && (
            <ScrollToLatestButton count={tally.count} onJump={() => void showLatest()} />
          )}
          {(c.error || copyError || uploads.error) && (
            <p className="ob-chat-error" role="alert">
              {c.error ?? copyError ?? uploads.error}
            </p>
          )}
          {c.reply && (
            <div className="ob-chat-reply-preview">
              <div>
                <span>
                  Replying to{" "}
                  {replyMessage?.senderMember?.name ??
                    (replyMessage?.author === "user" ? "you" : "agent")}
                </span>
                <blockquote className="ob-chat-reply-quote">
                  {replyMessage?.text.slice(0, 200) ?? "Earlier message"}
                </blockquote>
              </div>
              <button
                type="button"
                aria-label="Cancel reply"
                disabled={Boolean(c.fileAttempt)}
                onClick={() => c.setReply(null)}
              >
                <XIcon />
              </button>
            </div>
          )}
          <BotMessageComposer
            onDragOver={(event) => {
              if (uploads.available && event.dataTransfer.types.includes("Files"))
                event.preventDefault();
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length && uploads.available) {
                event.preventDefault();
                uploads.add(Array.from(event.dataTransfer.files));
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !c.busy &&
                !voice.busy &&
                uploads.uploads.length === 0 &&
                (c.selectedDraftId ? c.filePermission : c.permission && c.text.trim())
              )
                void c.send();
            }}
            onPointerDown={(event) => {
              if (
                !(event.target instanceof Element) ||
                event.target.closest(
                  "button, textarea, [contenteditable], [role=menuitem], [role=menu]",
                )
              )
                return;
              event.preventDefault();
              editor.current?.focus();
            }}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                uploads.add(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <BotComposerAttachments
              files={selectedFiles.map((draft) => draft.attachment)}
              uploads={uploads.uploads}
              disabled={c.busy || Boolean(c.fileAttempt)}
              onRemove={c.toggleDraft}
              reorderDisabled={!c.canReorderDrafts || uploads.uploads.length > 0}
              onReorder={c.reorderDrafts}
              onRemoveUpload={(key) => {
                void uploads.remove(key);
              }}
              onRetry={uploads.retry}
            />
            <BotComposerInput>
              <BotComposerEditor
                ref={editor}
                environmentId={environmentId}
                hostId={hostId}
                agentId={agentId}
                placeholder={c.reply ? "Reply…" : "Message…"}
                disabled={c.busy || Boolean(c.fileAttempt) || voice.busy}
                value={c.text}
                attachments={selectedFiles.map((draft) => ({
                  id: draft.attachment.id,
                  name: draft.attachment.name,
                }))}
                onFiles={uploads.available ? uploads.add : undefined}
                onChange={c.setText}
                onSubmit={() => {
                  if (
                    !c.busy &&
                    !voice.busy &&
                    uploads.uploads.length === 0 &&
                    (c.selectedDraftId ? c.filePermission : c.permission && c.text.trim())
                  )
                    void c.send();
                }}
              />
            </BotComposerInput>
            <BotComposerFooter
              actions={
                <>
                  {composerAccessory ?? (
                    <SourceModelPicker
                      environmentId={environmentId}
                      hostId={hostId}
                      agentId={agentId}
                    />
                  )}
                  <BotComposerVoice
                    voice={voice}
                    disabled={c.busy || Boolean(c.fileAttempt) || !c.permission}
                  />
                  <BotComposerSend
                    stop={stop}
                    busy={c.busy && !stop}
                    aria-label={stop ? "Stop turn" : "Send message"}
                    onClick={stop ? stopTurn : undefined}
                    disabled={
                      stop
                        ? disabled
                        : c.busy ||
                          voice.busy ||
                          uploads.uploads.length > 0 ||
                          (c.selectedDraftId ? !c.filePermission : !c.permission || !c.text.trim())
                    }
                  />
                </>
              }
            >
              <Menu>
                <MenuTrigger
                  render={<ComposerControl className="size-8 px-0" />}
                  aria-label="Add to message"
                  disabled={c.busy || Boolean(c.fileAttempt) || voice.busy}
                >
                  <PlusIcon />
                </MenuTrigger>
                <MenuPopup className="ob-chat-menu" side="top" align="start" sideOffset={8}>
                  <MenuItem
                    disabled={!uploads.available}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImageIcon />
                    Add image
                  </MenuItem>
                  <MenuItem
                    disabled={!uploads.available}
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileIcon />
                    Add context
                  </MenuItem>
                  {onOpenFiles && (
                    <MenuItem onClick={onOpenFiles}>
                      <FileIcon />
                      Browse files
                    </MenuItem>
                  )}
                  <MenuItem
                    onClick={() => {
                      // The source waits until the menu has restored trigger focus before opening the picker.
                      requestAnimationFrame(() =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() => editor.current?.openSkills()),
                        ),
                      );
                    }}
                  >
                    <PuzzleIcon />
                    Add skill
                  </MenuItem>
                  {c.fileDrafts.length > 0 && (
                    <MenuItem onClick={() => setPanel("files")}>
                      <FileIcon />
                      Choose uploaded files
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => setPanel("queue")}>
                    <ListIcon />
                    Edit queued messages
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </BotComposerFooter>
            <BotComposerVoiceStatus voice={voice} />
          </BotMessageComposer>
        </div>
        <Dialog
          open={panel !== null || detailsMessage !== undefined}
          onOpenChange={(open) => {
            if (!open) {
              setPanel(null);
              setDetailsId(null);
            }
          }}
        >
          <DialogPopup className="openbot-react ob-chat-dialog">
            <DialogHeader>
              <DialogTitle>
                {detailsMessage
                  ? "Message details"
                  : panel === "files"
                    ? "Choose uploaded files"
                    : panel === "thread"
                      ? "Thread settings"
                      : "Queue"}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel>
              {detailsMessage && (
                <div className="space-y-3">
                  <p>
                    {detailsMessage.author} · {detailsMessage.itemType ?? "message"} ·{" "}
                    {detailsMessage.status}
                  </p>
                  {botMessageSections(detailsMessage)
                    .filter(
                      (section) =>
                        section.kind !== "attachments" &&
                        !["[]", "{}", "null"].includes(section.value),
                    )
                    .map((section) => (
                      <details key={section.kind}>
                        <summary>{section.kind}</summary>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                          {section.value}
                        </pre>
                      </details>
                    ))}
                  {detailsMessage.deferredFields?.map((field) => (
                    <BotDeferredMessageDetail
                      key={field}
                      environmentId={environmentId}
                      hostId={hostId}
                      agentId={agentId}
                      taskId={taskId}
                      messageId={detailsMessage.id}
                      field={field}
                    />
                  ))}
                </div>
              )}
              {panel === "queue" && <BotConversationQueue controller={c} agentId={agentId} />}
              {panel === "files" && (
                <fieldset className="space-y-2">
                  <legend>Files ({c.selectedDraftIds.length}/10 selected)</legend>
                  {c.fileDrafts.map((draft) => (
                    <label className="flex items-center gap-2" key={draft.attachment.id}>
                      <input
                        type="checkbox"
                        checked={c.selectedDraftIds.includes(draft.attachment.id)}
                        disabled={
                          c.busy ||
                          Boolean(c.fileAttempt) ||
                          (c.selectedDraftIds.length >= 10 &&
                            !c.selectedDraftIds.includes(draft.attachment.id))
                        }
                        onChange={() => c.toggleDraft(draft.attachment.id)}
                      />
                      {draft.attachment.name} · {draft.state}
                    </label>
                  ))}
                  <p>Select up to 10 files for this message.</p>
                </fieldset>
              )}
              {panel === "thread" && taskId && (
                <div className="space-y-3">
                  <Input
                    aria-label="Thread title"
                    maxLength={120}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <Button
                    disabled={disabled || !title.trim()}
                    onClick={() =>
                      void c.act({ operation: "thread.rename", agentId, taskId, title })
                    }
                  >
                    Rename thread
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={disabled}
                      onClick={() => void c.act({ operation: "task.close", agentId, taskId })}
                    >
                      Close thread
                    </Button>
                    <Button
                      disabled={disabled}
                      onClick={() => void c.act({ operation: "task.reopen", agentId, taskId })}
                    >
                      Reopen thread
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={disabled}
                      onClick={async () => {
                        if (
                          await requestConfirmDialog("Delete this bot thread?", {
                            variant: "destructive",
                          })
                        )
                          await c.act({ operation: "thread.delete", agentId, taskId });
                      }}
                    >
                      Delete thread
                    </Button>
                  </div>
                </div>
              )}
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      </section>
    </BotFileSelectionContext>
  );
}

// The 20-unit paths are from OpenBot ConversationIcons.tsx, rather than approximate glyphs.
function MessageGlyph({ kind }: { kind: "reaction" | "reply" | "branch" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "reaction" ? (
        <>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M7.25 8h.01M12.75 8h.01M6.9 11.5c.85 1.25 1.88 1.85 3.1 1.85s2.25-.6 3.1-1.85" />
        </>
      ) : kind === "reply" ? (
        <path d="m8.25 5-4.5 4.1 4.5 4.1V10c4.1 0 6.45 1.35 8 4.35-.25-5.2-2.9-7.65-8-7.65z" />
      ) : (
        <path d="M13.33 2.5h4.17v4.17M6.67 2.5H2.5v4.17M10 17.5v-6.08a3.33 3.33 0 0 0-.98-2.36L2.5 2.5m10 5 5-5" />
      )}
    </svg>
  );
}
