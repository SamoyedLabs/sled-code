import type {
  EnvironmentId,
  OpenbotChannelMessage,
  OpenbotConversationMessage,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBotOutbox } from "./botOutbox";
import { BotPendingMessages, useEditingBotOutbox } from "./BotPendingMessages";
import { BotMessageComposer, useBotKeyboardAvoidance } from "./upstream/BotMessageComposer";
import { useBotCachedValue, useBotOfflineScope } from "./botOfflineCache";
import { BotGlass, BotIconButton, useBotPalette } from "./upstream/BotChrome";
import { Menu } from "../../components/ui/Menu";
import {
  chooseBotOutboxFile,
  releaseBotOutboxFiles,
  saveBotOutboxFiles,
  type BotOutboxFilePick,
} from "./botOutboxFiles";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { chatDayLabels } from "./upstream/chat-day-markers";
import { T, useGT } from "gt-react-native";

const OfflineRow = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  own: Schema.Boolean,
  author: Schema.NullOr(Schema.String.check(Schema.isMaxLength(120))),
  text: Schema.String.check(Schema.isMaxLength(10_000)),
  createdAt: Schema.String.check(Schema.isMaxLength(160)),
  files: Schema.Array(Schema.String.check(Schema.isMaxLength(255))).check(Schema.isMaxLength(10)),
});
type OfflineRow = typeof OfflineRow.Type;
const OfflineRows = Schema.Array(OfflineRow).check(Schema.isMaxLength(50));
const decodeRows = Schema.decodeUnknownOption(OfflineRows);
const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.Struct({
    threadId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
    rows: OfflineRows,
    groupAttachmentAgentId: Schema.optionalKey(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    ),
  }),
);
function decode(value: unknown) {
  const snapshot = decodeSnapshot(value);
  if (snapshot._tag === "Some") return snapshot.value;
  const rows = decodeRows(value);
  return rows._tag === "Some"
    ? { threadId: null, rows: rows.value, groupAttachmentAgentId: undefined }
    : null;
}
type Chat = { kind: "agent"; id: string; taskId?: string | null } | { kind: "group"; id: string };
type ChatScope = { environmentId: EnvironmentId; hostId: string; chat: Chat };
function cacheName(hostId: string, chat: Chat) {
  return JSON.stringify([
    "chat",
    hostId,
    chat.kind,
    chat.id,
    chat.kind === "agent" ? (chat.taskId ?? null) : null,
  ]);
}

function cacheMessage(
  message: OpenbotConversationMessage | OpenbotChannelMessage["message"],
  own: boolean,
  author: string | null,
): OfflineRow | null {
  if (message.status === "streaming") return null;
  const files = Array.isArray(message.attachments)
    ? message.attachments
        .slice(0, 10)
        .flatMap((attachment: unknown) =>
          attachment &&
          typeof attachment === "object" &&
          "name" in attachment &&
          typeof attachment.name === "string"
            ? [attachment.name.slice(0, 255)]
            : [],
        )
    : [];
  if (!message.text && !files.length) return null;
  return {
    id: message.id,
    own,
    author: author?.slice(0, 120) ?? null,
    text: message.text.slice(0, 10_000),
    createdAt: message.createdAt,
    files,
  };
}

function useRememberBotChat<T>(
  { environmentId, hostId, chat }: ChatScope,
  messages: readonly T[] | null,
  project: (message: T) => OfflineRow | null,
  threadId: string | null,
  groupAttachmentAgentId?: string,
) {
  const scope = useBotOfflineScope(environmentId);
  const live = useMemo(
    () =>
      messages
        ? {
            threadId,
            ...(groupAttachmentAgentId ? { groupAttachmentAgentId } : {}),
            rows: messages.slice(-50).flatMap((entry) => {
              const row = project(entry);
              return row ? [row] : [];
            }),
          }
        : null,
    [messages, project, threadId, groupAttachmentAgentId],
  );
  useBotCachedValue({ scope, name: cacheName(hostId, chat), live, decode });
}

const agentRow = (message: OpenbotConversationMessage) =>
  cacheMessage(message, message.author === "user", null);
const groupRow = (entry: OpenbotChannelMessage) =>
  cacheMessage(entry.message, entry.author.kind === "member", entry.author.name);

export function useRememberAgentChat(
  scope: ChatScope,
  messages: readonly OpenbotConversationMessage[] | null,
  threadId: string | null,
) {
  useRememberBotChat(scope, messages, agentRow, threadId);
}

export function useRememberGroupChat(
  scope: ChatScope,
  messages: readonly OpenbotChannelMessage[] | null,
  groupAttachmentAgentId?: string,
) {
  useRememberBotChat(
    scope,
    messages,
    groupRow,
    groupAttachmentAgentId ? scope.chat.id : null,
    groupAttachmentAgentId,
  );
}

export function BotOfflineHistory({
  environmentId,
  hostId,
  chat,
  connecting,
}: ChatScope & { connecting: boolean }) {
  const gt = useGT();
  const scope = useBotOfflineScope(environmentId);
  const saved = useBotCachedValue({ scope, name: cacheName(hostId, chat), live: null, decode });
  const rows = saved?.rows;
  const groupAttachmentAgentId = chat.kind === "group" ? saved?.groupAttachmentAgentId : undefined;
  const mayAttach = Boolean(saved?.threadId && (chat.kind === "agent" || groupAttachmentAgentId));
  const { outbox, snapshot } = useBotOutbox(scope);
  const editingQueued = useEditingBotOutbox({ environmentId, hostId, chat });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [files, setFiles] = useState<readonly BotOutboxFilePick[]>([]);
  const [picking, setPicking] = useState(false);
  const sending = useRef(false);
  const insets = useSafeAreaInsets();
  const padding = Math.max(insets.bottom, 10);
  const keyboard = useBotKeyboardAvoidance(padding);
  const p = useBotPalette();
  const scroll = useRef<ScrollViewInstance>(null);
  const days = useMemo(() => chatDayLabels(rows ?? []), [rows]);
  return (
    <Animated.View style={[{ flex: 1, backgroundColor: p.canvas }, keyboard]}>
      <Text
        accessibilityRole="status"
        style={{ color: p.muted, padding: 14, textAlign: "center", fontSize: 13 }}
      >
        {connecting
          ? gt("Connecting…")
          : rows?.length
            ? gt("Offline · Saved messages")
            : gt("Waiting for connection")}
      </Text>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24, gap: 12 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {rows?.map((row) => (
          <View key={row.id} style={{ gap: 5 }}>
            {days.get(row.id) && (
              <Text style={{ color: p.muted, textAlign: "center", fontSize: 12 }}>
                {days.get(row.id)}
              </Text>
            )}
            <View
              style={{ alignSelf: row.own ? "flex-end" : "flex-start", maxWidth: "88%", gap: 5 }}
            >
              {row.author && <Text style={{ color: p.muted, fontSize: 12 }}>{row.author}</Text>}
              {row.text && (
                <Text
                  selectable
                  style={{
                    color: p.text,
                    fontSize: 16,
                    lineHeight: 23,
                    padding: 12,
                    borderRadius: 18,
                    backgroundColor: row.own ? p.control : p.surface,
                  }}
                >
                  {row.text}
                </Text>
              )}
              {Array.from(new Set(row.files)).map((file) => (
                <Text key={file} style={{ color: p.muted, fontSize: 13 }}>
                  {file}
                </Text>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      {outbox && (
        <View style={{ paddingHorizontal: 12, paddingBottom: padding, gap: 8 }}>
          <BotPendingMessages environmentId={environmentId} hostId={hostId} chat={chat} />
          {!editingQueued && (
            <>
              {(failed || snapshot.storageError) && (
                <Text accessibilityRole="alert" style={{ color: p.text }}>
                  <T>Could not save this message on your device.</T>
                </Text>
              )}
              {files.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {files.map((file) => (
                    <Pressable
                      key={file.id}
                      accessibilityRole="button"
                      accessibilityLabel={gt("Remove attachment {name}", { name: file.name })}
                      disabled={saving}
                      onPress={() =>
                        setFiles((current) => current.filter(({ id }) => id !== file.id))
                      }
                      style={{
                        backgroundColor: p.control,
                        borderRadius: 12,
                        padding: 8,
                        maxWidth: "100%",
                      }}
                    >
                      <Text numberOfLines={1} style={{ color: p.text }}>
                        {file.name} ×
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
                {mayAttach && (
                  <Menu
                    actions={[
                      { id: "files", title: gt("Files") },
                      { id: "photos", title: gt("Photos") },
                      { id: "camera", title: gt("Camera") },
                    ]}
                    onPressAction={async ({ nativeEvent }) => {
                      const source = nativeEvent.event;
                      if (picking || saving) return;
                      if (source !== "files" && source !== "photos" && source !== "camera") return;
                      setPicking(true);
                      try {
                        const file = await chooseBotOutboxFile(source);
                        if (file)
                          setFiles((current) =>
                            current.length < 10 ? [...current, file] : current,
                          );
                      } catch {
                        setFailed(true);
                      }
                      setPicking(false);
                    }}
                  >
                    <BotGlass>
                      <BotIconButton
                        label={gt("Attach to queued message")}
                        icon="plus"
                        disabled={saving || picking || files.length >= 10}
                      />
                    </BotGlass>
                  </Menu>
                )}
                <BotMessageComposer
                  label={chat.kind === "group" ? gt("Message to group") : gt("Message to bot")}
                  text={text}
                  onChangeText={setText}
                  editable={!saving && snapshot.ready}
                  action="send"
                  actionDisabled={
                    saving || picking || !snapshot.ready || (!text.trim() && !files.length)
                  }
                  onAction={async (committedText) => {
                    if (
                      !scope ||
                      sending.current ||
                      picking ||
                      (!committedText.trim() && !files.length)
                    )
                      return;
                    sending.current = true;
                    setSaving(true);
                    setFailed(false);
                    await (async () => {
                      const stored = await saveBotOutboxFiles(scope, files);
                      const queued = await outbox.enqueue({
                        hostId,
                        chat,
                        text: committedText,
                        replyToMessageId: null,
                        ...(saved?.threadId && (chat.kind === "agent" || stored.length)
                          ? { expectedThreadId: saved.threadId }
                          : {}),
                        ...(stored.length && groupAttachmentAgentId
                          ? { groupAttachmentAgentId }
                          : {}),
                        ...(stored.length ? { files: stored } : {}),
                      });
                      if (queued) {
                        setText("");
                        setFiles([]);
                        Keyboard.dismiss();
                      } else {
                        await releaseBotOutboxFiles(scope, stored);
                        setFailed(true);
                      }
                    })()
                      .catch(() => {
                        setFailed(true);
                      })
                      .finally(() => {
                        sending.current = false;
                        setSaving(false);
                      });
                  }}
                  showVoiceControl={false}
                />
              </View>
            </>
          )}
        </View>
      )}
    </Animated.View>
  );
}
