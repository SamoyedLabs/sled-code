import { useSourceChatVirtualizer } from "./conversation/useSourceChatVirtualizer";
/* oxlint-disable shadcn/no-unknown-classes -- Faithful DirectConversation DOM and source styles are in People.css. */
import { useLayoutEffect, useRef, useState } from "react";
import type { OpenbotPerson, OpenbotDirectMessage, OpenbotDirectPage } from "@t3tools/contracts";
import { LockIcon, ArrowDownIcon } from "lucide-react";
import { SourcePersonAvatar } from "./SourcePersonAvatar";
import { personName } from "./directModel";
import "./People.css";
import { T, Var, useGT } from "gt-react";

export function SourceDirectConversation({
  member,
  selfId,
  messages,
  readState,
  loading,
  error,
  hasOlder,
  busy,
  text,
  uncertain,
  canSend,
  onText,
  onSend,
  onOlder,
  onMarkRead,
  onRefresh,
  modifierSend = false,
  anchored = false,
  onOpenMessage,
  onLatest,
}: {
  member: OpenbotPerson;
  selfId: string;
  messages: readonly OpenbotDirectMessage[];
  readState: OpenbotDirectPage["readState"];
  loading: boolean;
  error: string | null;
  hasOlder: boolean;
  busy: boolean;
  text: string;
  uncertain: boolean;
  canSend: boolean;
  modifierSend?: boolean;
  anchored?: boolean;
  onOpenMessage?: (id: string) => void;
  onLatest?: () => void;
  onText: (text: string) => void;
  onSend: () => void;
  onOlder: () => void;
  onMarkRead: () => void;
  onRefresh: () => void;
}) {
  const gt = useGT();
  const list = useRef<HTMLDivElement>(null),
    sticky = useRef(true),
    previousHeight = useRef<{ height: number; first: string | undefined } | null>(null);
  const virtualRoot = useRef<HTMLDivElement>(null);
  const virtual = useSourceChatVirtualizer(
    list,
    virtualRoot,
    messages.map((message) => message.id),
    sticky,
  );
  const [away, setAway] = useState(false);
  const jumpTarget = useRef<string | null>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
  const first = messages[0]?.id,
    last = messages.at(-1)?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Preserve the DOM scroll anchor when prepending history; follow new messages only while already at the bottom.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (!first && !last) {
      sticky.current = true;
      return;
    }
    if (previousHeight.current !== null) {
      if (first !== previousHeight.current.first)
        element.scrollTop += element.scrollHeight - previousHeight.current.height;
      previousHeight.current = null;
    } else if (sticky.current) element.scrollTop = element.scrollHeight;
  }, [first, last]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A requested unread identity may need an anchored page and virtual row measurement before it can be revealed.
  useLayoutEffect(() => {
    if (!jumpRequest || !jumpTarget.current) return;
    const index = messages.findIndex((message) => message.id === jumpTarget.current);
    if (index < 0) return;
    virtual.instance.scrollToIndex(index, { align: "start", behavior: "auto" });
    jumpTarget.current = null;
    onMarkRead();
  }, [jumpRequest, messages, virtual.instance, onMarkRead]);
  const latest = () => {
    const element = list.current;
    if (!element) return;
    sticky.current = true;
    setAway(false);
    if (anchored && onLatest) {
      onLatest();
      return;
    }
    element.scrollTo({
      top: element.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  const send = () => {
    sticky.current = true;
    setAway(false);
    onSend();
  };
  const unreadId = readState?.firstUnreadMessageId;
  return (
    <section
      className="direct-conversation"
      aria-label={gt("Conversation with {personName}", { personName: personName(member) })}
    >
      <header className="direct-conversation-header">
        <div className="direct-conversation-person">
          <SourcePersonAvatar member={member} size={30} />
          <div>
            <h1>{personName(member)}</h1>
            <span className={member.online ? "online" : undefined}>
              <i />
              {member.online ? gt("Online") : gt("Offline")}
            </span>
          </div>
        </div>
        <span className="direct-private-label">
          <LockIcon />
          <T>Private</T>
        </span>
      </header>
      {(readState?.unreadCount ?? 0) > 0 && (
        <div className="unread-messages-banner" role="status">
          <button
            type="button"
            className="unread-messages-jump"
            onClick={() => {
              if (!unreadId) return;
              sticky.current = false;
              jumpTarget.current = unreadId;
              setJumpRequest((request) => request + 1);
              if (!messages.some((message) => message.id === unreadId)) onOpenMessage?.(unreadId);
            }}
          >
            <T>
              <Var>{readState!.unreadCount}</Var> new messages
            </T>
          </button>
          <button
            type="button"
            className="unread-messages-mark-read"
            disabled={busy || !canSend}
            onClick={onMarkRead}
          >
            <span className="unread-messages-mark-read-label">
              <T>Mark as read</T>
            </span>
          </button>
        </div>
      )}
      <div
        ref={list}
        className="direct-message-list"
        role="log"
        aria-label={gt("Direct messages")}
        onScroll={(event) => {
          const element = event.currentTarget;
          sticky.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
          setAway(!sticky.current);
        }}
      >
        {loading ? (
          <div className="direct-conversation-state">
            <T>Loading conversation…</T>
          </div>
        ) : !messages.length ? (
          <div className="direct-conversation-empty">
            <SourcePersonAvatar member={member} size={48} />
            <h2>{personName(member)}</h2>
            <p>
              <T>Send a private message to start a conversation.</T>
            </p>
          </div>
        ) : (
          <>
            {hasOlder && (
              <button
                type="button"
                className="conversation-history-status"
                disabled={busy}
                onClick={() => {
                  previousHeight.current = { height: list.current?.scrollHeight ?? 0, first };
                  sticky.current = false;
                  onOlder();
                }}
              >
                <T>Load older messages</T>
              </button>
            )}
            <div
              ref={virtualRoot}
              className={`ui-message-group virtual-chat-list${virtual.virtualized ? "" : " virtual-chat-list-static"}`}
              style={{ height: virtual.virtualized ? virtual.total : "auto" }}
            >
              {virtual.items.map((item) => {
                const index = item.index,
                  message = messages[index];
                if (!message) return null;
                const own = message.senderMemberId === selfId,
                  grouped =
                    messages[index - 1]?.senderMemberId === message.senderMemberId &&
                    message.id !== unreadId;
                return (
                  <div
                    key={message.id}
                    data-index={index}
                    ref={(element) => virtual.instance.measureElement(element)}
                    style={{
                      position: virtual.virtualized ? "absolute" : "relative",
                      top: virtual.virtualized ? 0 : undefined,
                      width: "100%",
                      transform: virtual.virtualized
                        ? `translateY(${item.start - virtual.margin}px)`
                        : undefined,
                    }}
                    data-direct-message-id={message.id}
                    className="virtual-chat-row direct-message-row"
                    data-grouped={grouped ? "sender" : undefined}
                  >
                    {message.id === unreadId && (
                      <div className="unread-messages-divider">
                        <hr />
                        <span>
                          <T>New messages</T>
                        </span>
                        <hr />
                      </div>
                    )}
                    <article
                      className={`ui-message direct-message${own ? " own" : ""}`}
                      data-align={own ? "end" : "start"}
                      data-author={own ? "user" : "member"}
                      aria-label={`${own ? "You" : personName(member)}, ${message.createdAt}`}
                    >
                      <div className="ui-message-content">
                        <div
                          className={`ui-bubble ui-bubble-variant-${own ? "secondary" : "muted"}`}
                          data-align={own ? "end" : "start"}
                        >
                          <div className="ui-bubble-content">{message.text}</div>
                        </div>
                        <div className="ui-message-footer">
                          <time dateTime={message.createdAt}>
                            {new Date(message.createdAt).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
            {(away || anchored) && (
              <div className="scroll-to-latest" aria-live="off">
                <button
                  type="button"
                  className="scroll-to-latest-button"
                  aria-label={gt("Scroll to latest message")}
                  onClick={latest}
                >
                  <ArrowDownIcon />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="direct-composer-wrap">
        {error && (
          <p className="direct-message-error" role="alert">
            {error}{" "}
            <button type="button" onClick={onRefresh}>
              <T>Refresh</T>
            </button>
          </p>
        )}
        {uncertain && (
          <p className="direct-message-error" role="status">
            <T>Delivery is unconfirmed. Retry uses the same message identity.</T>
          </p>
        )}
        <div className="direct-composer">
          <textarea
            value={text}
            rows={1}
            maxLength={20_000}
            aria-label={gt("Message {personName}", { personName: personName(member) })}
            placeholder={gt("Message {personName}", { personName: personName(member) })}
            disabled={busy || uncertain || !canSend}
            onChange={(event) => onText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.keyCode === 229 ||
                event.key !== "Enter" ||
                event.shiftKey ||
                (modifierSend && !(event.metaKey || event.ctrlKey))
              )
                return;
              event.preventDefault();
              send();
            }}
          />
          <button
            type="button"
            aria-label={uncertain ? gt("Retry same message") : gt("Send message")}
            disabled={!text.trim() || busy || !canSend}
            onClick={send}
          >
            {busy ? "…" : "↑"}
          </button>
        </div>
      </div>
    </section>
  );
}
