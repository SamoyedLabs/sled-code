import { botSemanticMarkdown } from "../bots/botSemanticMarkdown";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { botQuoteReference } from "@t3tools/client-runtime/openbot/presentation";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { BotIncomingShareEnvironment } from "../sharing/BotIncomingShareEnvironment";
import { BotDictation, useBotDictation } from "./BotDictation";
import { BotResponseBlock } from "./BotResponseBlock";
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
import { T, Var, useGT } from "gt-react-native";
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
  const gt = useGT();
  const c = useBotConversationPanel(environmentId, hostId, agentId, taskId, Crypto.randomUUID);
  const markdown = useMarkdownPreviewStyles();
  const [title, setTitle] = useState("");
  const voice = useBotDictation(
    JSON.stringify(["bot", environmentId, hostId, agentId, taskId]),
    c.text,
    c.setText,
    c.busy || Boolean(c.fileAttempt) || !c.permission,
  );
  const disabled = c.busy || !c.permission;
  return (
    <View className="gap-3">
      {c.snapshot?.threadId && (
        <BotIncomingShareEnvironment
          environmentId={environmentId}
          hostId={hostId}
          agentId={agentId}
          threadId={c.snapshot.threadId}
          taskId={taskId}
        />
      )}
      <Button label={gt("Refresh conversation")} onPress={c.refresh} />
      {c.loading && (
        <Text>
          <T>Loading conversation…</T>
        </Text>
      )}
      {c.error && <Text accessibilityRole="alert">{c.error}</Text>}
      {taskId && (
        <View className="gap-2">
          <AppTextInput
            accessibilityLabel={gt("Thread title")}
            maxLength={120}
            value={title}
            onChangeText={setTitle}
          />
          <Button
            label={gt("Rename thread")}
            disabled={disabled || !title.trim()}
            onPress={() => void c.act({ operation: "thread.rename", agentId, taskId, title })}
          />
          <Button
            label={gt("Delete thread")}
            disabled={disabled}
            onPress={() =>
              Dialog.alert(
                gt("Delete bot thread?"),
                gt("This removes the thread and its conversation."),
                [
                  { text: gt("Cancel"), style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => void c.act({ operation: "thread.delete", agentId, taskId }),
                  },
                ],
              )
            }
          />
        </View>
      )}
      {c.hasOlder && !taskId && (
        <Button
          label={gt("Load older messages")}
          disabled={c.busy}
          onPress={() => void c.older()}
        />
      )}
      {c.messages.map((message) => (
        <View key={message.id} className="gap-2 border-b border-border pb-3">
          <Text className="font-t3-medium">
            {message.senderMember?.name ?? message.senderAgentId ?? message.author} ·{" "}
            {message.itemType ?? "message"} · {message.status}
          </Text>
          {message.replyToMessageId && (
            <Text>
              <T>
                Reply to<Var> </Var>
                <Var>
                  {(
                    c.messages.find((m) => m.id === message.replyToMessageId) ??
                    c.references[message.replyToMessageId]
                  )?.text.slice(0, 200) ?? message.replyToMessageId}
                </Var>
              </T>
            </Text>
          )}
          <SelectableMarkdownText
            markdown={botSemanticMarkdown(message.text)}
            textStyle={markdown.nativeTextStyle}
            linkCustomization={(url) => {
              const quote = botQuoteReference(url);
              return quote
                ? { label: quote.text.replace(/\s+/gu, " "), chip: { tintsIcon: true } }
                : undefined;
            }}
            onLinkPress={(url) => {
              const quote = botQuoteReference(url);
              if (quote) Dialog.alert(gt("Quoted passage"), quote.text);
              else void tryOpenExternalUrl(url, "markdown-link");
            }}
          />
          {botMessageSections(message).map((section) => (
            <RichSection key={section.kind} {...section} />
          ))}
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
          <Button label={gt("Reply")} disabled={disabled} onPress={() => c.setReply(message.id)} />
          <Button
            label={gt("Branch here")}
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
                label={gt("React 👍")}
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
                label={gt("Clear reaction")}
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
      {c.snapshot?.readState && (
        <Text>
          <T>
            <Var>{c.snapshot.readState.unreadCount}</Var> unread messages
          </T>
        </Text>
      )}
      {taskId && (
        <View className="gap-2">
          <Button
            label={gt("Close thread")}
            disabled={disabled}
            onPress={() => void c.act({ operation: "task.close", agentId, taskId })}
          />
          <Button
            label={gt("Reopen thread")}
            disabled={disabled}
            onPress={() => void c.act({ operation: "task.reopen", agentId, taskId })}
          />
          <Text>
            <T>
              Side threads expose the released recent snapshot; older paging is available in the
              main conversation.
            </T>
          </Text>
        </View>
      )}
      {c.messages.length > 0 && (
        <Button
          label={gt("Mark read")}
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
          label={gt("Mark unread")}
          disabled={disabled}
          onPress={() => void c.act({ operation: "conversation.markUnread", agentId })}
        />
      )}
      {c.reply && (
        <Button
          label={gt("Cancel reply to {reply}", { reply: c.reply })}
          onPress={() => c.setReply(null)}
        />
      )}
      <Text>
        <T>
          Select up to 10 drafts from Files for one message, including replies. Selection is not
          sending.
        </T>
      </Text>
      <Button
        label={gt("No file")}
        disabled={c.busy || Boolean(c.fileAttempt)}
        onPress={() => c.setSelectedDraftId(null)}
      />
      {c.fileDrafts.map((d) => (
        <Button
          key={d.attachment.id}
          label={`${c.selectedDraftIds.includes(d.attachment.id) ? "Selected: " : ""}${d.attachment.name} · ${d.state}`}
          disabled={
            c.busy ||
            Boolean(c.fileAttempt) ||
            (c.selectedDraftIds.length >= 10 && !c.selectedDraftIds.includes(d.attachment.id))
          }
          onPress={() => c.toggleDraft(d.attachment.id)}
        />
      ))}
      <AppTextInput
        editable={!c.fileAttempt && !voice.freezesEditor}
        accessibilityLabel={gt("Message to bot")}
        multiline
        maxLength={100000}
        value={c.text}
        onChangeText={c.setText}
      />
      <BotDictation voice={voice} disabled={c.busy || Boolean(c.fileAttempt) || !c.permission} />
      <Button
        label={gt("Send")}
        disabled={
          c.busy ||
          voice.blocksSubmission ||
          (c.selectedDraftId ? !c.filePermission : !c.permission || !c.text.trim())
        }
        onPress={() => void c.send()}
      />
      {c.snapshot?.activeTurnId && (
        <Button
          label={gt("Stop turn")}
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
      {<BotConversationQueue controller={c} agentId={agentId} />}
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
