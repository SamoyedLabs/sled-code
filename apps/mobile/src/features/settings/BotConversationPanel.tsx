import { BotUiBlock } from "./BotUiBlock";
import { useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import type { EnvironmentId } from "@t3tools/contracts";
import { botMessageSections } from "@t3tools/client-runtime/openbot/presentation";
import { useBotConversationPanel } from "./useBotConversationPanel";
import { BotConversationQueue } from "./BotConversationQueue";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
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
  const c = useBotConversationPanel(environmentId, hostId, agentId, taskId, Crypto.randomUUID);
  const [title, setTitle] = useState("");
  const disabled = c.busy || !c.permission;
  return (
    <View className="gap-3">
      <Button label="Refresh conversation" onPress={c.refresh} />
      {c.loading && <Text>Loading conversation…</Text>}
      {c.error && <Text accessibilityRole="alert">{c.error}</Text>}
      {taskId && (
        <View className="gap-2">
          <AppTextInput
            accessibilityLabel="Thread title"
            maxLength={120}
            value={title}
            onChangeText={setTitle}
          />
          <Button
            label="Rename thread"
            disabled={disabled || !title.trim()}
            onPress={() => void c.act({ operation: "thread.rename", agentId, taskId, title })}
          />
          <Button
            label="Delete thread"
            disabled={disabled}
            onPress={() =>
              Dialog.alert("Delete bot thread?", "This removes the thread and its conversation.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => void c.act({ operation: "thread.delete", agentId, taskId }),
                },
              ])
            }
          />
        </View>
      )}
      {c.hasOlder && !taskId && (
        <Button label="Load older messages" disabled={c.busy} onPress={() => void c.older()} />
      )}
      {c.messages.map((message) => (
        <View key={message.id} className="gap-2 border-b border-border pb-3">
          <Text className="font-t3-medium">
            {message.senderMember?.name ?? message.senderAgentId ?? message.author} ·{" "}
            {message.itemType ?? "message"} · {message.status}
          </Text>
          {message.replyToMessageId && (
            <Text>
              Reply to{" "}
              {(
                c.messages.find((m) => m.id === message.replyToMessageId) ??
                c.references[message.replyToMessageId]
              )?.text.slice(0, 200) ?? message.replyToMessageId}
            </Text>
          )}
          <Text selectable>{message.text}</Text>
          {botMessageSections(message).map((section) => (
            <RichSection key={section.kind} {...section} />
          ))}
          <BotUiBlock
            key={JSON.stringify([message.id, message.uiBlock])}
            environmentId={environmentId}
            hostId={hostId}
            message={message}
            snapshot={c.snapshot}
            taskId={taskId}
            disabled={disabled}
            respond={c.act}
          />
          <Button label="Reply" disabled={disabled} onPress={() => c.setReply(message.id)} />
          <Button
            label="Branch here"
            disabled={
              disabled ||
              (message.author !== "assistant" && message.author !== "agent") ||
              message.status === "streaming" ||
              Boolean(c.snapshot?.activeTurnId)
            }
            onPress={() => void c.branch(message.id)}
          />
          {!taskId && (
            <>
              <Button
                label="React 👍"
                disabled={disabled}
                onPress={() =>
                  void c.act({
                    operation: "conversation.react",
                    agentId,
                    messageId: message.id,
                    emoji: "👍",
                  })
                }
              />
              <Button
                label="Clear reaction"
                disabled={disabled}
                onPress={() =>
                  void c.act({
                    operation: "conversation.react",
                    agentId,
                    messageId: message.id,
                    emoji: null,
                  })
                }
              />
            </>
          )}
        </View>
      ))}
      {c.snapshot?.readState && <Text>{c.snapshot.readState.unreadCount} unread messages</Text>}
      {taskId && (
        <View className="gap-2">
          <Button
            label="Close thread"
            disabled={disabled}
            onPress={() => void c.act({ operation: "task.close", agentId, taskId })}
          />
          <Button
            label="Reopen thread"
            disabled={disabled}
            onPress={() => void c.act({ operation: "task.reopen", agentId, taskId })}
          />
          <Text>
            Side threads expose the released recent snapshot; older paging is available in the main
            conversation.
          </Text>
        </View>
      )}
      {c.messages.length > 0 && (
        <Button
          label="Mark read"
          disabled={disabled}
          onPress={() => {
            const throughMessageId = c.messages.at(-1)!.id;
            void c.act(
              taskId
                ? { operation: "thread.markRead", agentId, taskId, throughMessageId }
                : { operation: "conversation.markRead", agentId, throughMessageId },
            );
          }}
        />
      )}
      {!taskId && (
        <Button
          label="Mark unread"
          disabled={disabled}
          onPress={() => void c.act({ operation: "conversation.markUnread", agentId })}
        />
      )}
      {c.reply && <Button label={`Cancel reply to ${c.reply}`} onPress={() => c.setReply(null)} />}
      <Text>
        File draft from Files (one file per journaled message). Selection is not sending. Cancel a
        reply to send a file.
      </Text>
      <Button
        label="No file"
        disabled={c.busy || Boolean(c.fileAttempt)}
        onPress={() => c.setSelectedDraftId(null)}
      />
      {c.fileDrafts.map((d) => (
        <Button
          key={d.attachment.id}
          label={`${c.selectedDraftId === d.attachment.id ? "Selected: " : ""}${d.attachment.name} · ${d.state}`}
          disabled={c.busy || Boolean(c.fileAttempt) || Boolean(c.reply)}
          onPress={() => c.setSelectedDraftId(d.attachment.id)}
        />
      ))}
      <AppTextInput
        editable={!c.fileAttempt}
        accessibilityLabel="Message to bot"
        multiline
        maxLength={100000}
        value={c.text}
        onChangeText={c.setText}
      />
      <Button
        label="Send"
        disabled={
          c.busy ||
          (c.selectedDraftId
            ? !c.filePermission || Boolean(c.reply)
            : !c.permission || !c.text.trim())
        }
        onPress={() => void c.send()}
      />
      {c.snapshot?.activeTurnId && (
        <Button
          label="Stop turn"
          disabled={disabled}
          onPress={() =>
            void c.act(
              taskId
                ? { operation: "task.stop", agentId, taskId }
                : { operation: "conversation.stop", agentId, turnId: c.snapshot!.activeTurnId! },
            )
          }
        />
      )}
      {!taskId && <BotConversationQueue controller={c} agentId={agentId} />}
    </View>
  );
}
function RichSection({ kind, value }: { kind: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Button
        label={`${expanded ? "Hide" : "Show"} ${kind}`}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <Text selectable>{value}</Text>}
    </View>
  );
}
