import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { botMessageSections } from "@t3tools/client-runtime/openbot/presentation";
import { useBotConversationPanel } from "./useBotConversationPanel";
import { BotConversationQueue } from "./BotConversationQueue";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { requestConfirmDialog } from "../../confirmDialog";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  taskId?: string | null;
};
export function BotConversationPanel(props: Props) {
  return (
    <ConversationBody
      key={JSON.stringify([props.environmentId, props.hostId, props.agentId, props.taskId])}
      {...props}
    />
  );
}
function ConversationBody({ environmentId, hostId, agentId, taskId = null }: Props) {
  const c = useBotConversationPanel(environmentId, hostId, agentId, taskId, randomUUID);
  const [title, setTitle] = useState("");
  const disabled = c.busy || !c.permission;
  return (
    <section aria-label="Bot conversation" className="space-y-3">
      <Button variant="outline" size="sm" onClick={c.refresh}>
        Refresh conversation
      </Button>
      {c.loading && <p role="status">Loading conversation…</p>}
      {c.error && <p role="alert">{c.error}</p>}
      {taskId && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Thread title"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            disabled={disabled || !title.trim()}
            onClick={() => void c.act({ operation: "thread.rename", agentId, taskId, title })}
          >
            Rename thread
          </Button>
          <Button
            variant="destructive"
            disabled={disabled}
            onClick={async () => {
              if (await requestConfirmDialog("Delete this bot thread?", { variant: "destructive" }))
                await c.act({ operation: "thread.delete", agentId, taskId });
            }}
          >
            Delete thread
          </Button>
        </div>
      )}
      {c.hasOlder && !taskId && (
        <Button disabled={c.busy} onClick={() => void c.older()}>
          Load older messages
        </Button>
      )}
      <ol className="max-h-[32rem] space-y-4 overflow-auto">
        {c.messages.map((message) => (
          <li key={message.id} className="space-y-2 border-b pb-3">
            <p className="text-sm font-medium">
              {message.senderMember?.name ?? message.senderAgentId ?? message.author} ·{" "}
              {message.itemType ?? "message"} · {message.status}
            </p>
            {message.replyToMessageId && (
              <blockquote className="border-l-2 pl-2 text-sm">
                Reply to{" "}
                {(
                  c.messages.find((m) => m.id === message.replyToMessageId) ??
                  c.references[message.replyToMessageId]
                )?.text.slice(0, 200) ?? message.replyToMessageId}
              </blockquote>
            )}
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
            {botMessageSections(message).map((section) => (
              <details key={section.kind}>
                <summary>{section.kind}</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {section.value}
                </pre>
              </details>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => c.setReply(message.id)}
              >
                Reply
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  disabled ||
                  message.status === "streaming" ||
                  (message.author !== "assistant" && message.author !== "agent") ||
                  Boolean(c.snapshot?.activeTurnId)
                }
                onClick={() => void c.branch(message.id)}
              >
                Branch here
              </Button>
              {!taskId && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void c.act({
                        operation: "conversation.react",
                        agentId,
                        messageId: message.id,
                        emoji: "👍",
                      })
                    }
                  >
                    👍
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
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
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {c.snapshot?.readState && <p>{c.snapshot.readState.unreadCount} unread messages</p>}
      {taskId && (
        <div className="flex gap-2">
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
          <p>
            Side threads expose the released recent snapshot; older paging is available in the main
            conversation.
          </p>
        </div>
      )}
      {c.messages.length > 0 && (
        <Button
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
        </Button>
      )}
      {!taskId && (
        <Button
          disabled={disabled}
          onClick={() => void c.act({ operation: "conversation.markUnread", agentId })}
        >
          Mark unread
        </Button>
      )}
      {c.reply && (
        <p>
          Replying to {c.reply}{" "}
          <Button size="sm" variant="outline" onClick={() => c.setReply(null)}>
            Cancel reply
          </Button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void c.send();
        }}
        className="space-y-2"
      >
        <Textarea
          aria-label="Message to bot"
          maxLength={100000}
          value={c.text}
          onChange={(e) => c.setText(e.target.value)}
        />
        <Button type="submit" disabled={disabled || !c.text.trim()}>
          Send
        </Button>
      </form>
      {c.snapshot?.activeTurnId && (
        <Button
          disabled={disabled}
          onClick={() =>
            void c.act(
              taskId
                ? { operation: "task.stop", agentId, taskId }
                : { operation: "conversation.stop", agentId, turnId: c.snapshot!.activeTurnId! },
            )
          }
        >
          Stop turn
        </Button>
      )}
      {!taskId && <BotConversationQueue controller={c} agentId={agentId} />}
    </section>
  );
}
