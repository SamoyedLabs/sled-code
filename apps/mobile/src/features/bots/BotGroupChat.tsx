import * as Dialog from "../../components/ui/Dialog";
import {
  OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
  OPENBOT_MESSAGE_DELETE_CAPABILITY,
} from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { useBotMessageReading } from "./upstream/voice/BotMessageReading";
import { BotLiveVoiceBar } from "./upstream/voice/BotLiveVoiceBar";
import { groupBotVoiceReply, useBotLiveVoice } from "./upstream/voice/useBotLiveVoice";
import { BotMessageActivity } from "./BotMessageActivity";
import { BotReplyMarkdown, BotTypingBubble } from "./BotReplyMotion";
import { BotChatEndPullRing, useBotChatEndPull } from "./BotChatEndPull";
import { BotMessageSwipe, useBotMessageActionButtons } from "./BotMessageSwipe";
import { BotOfflineHistory, useRememberGroupChat } from "./BotOfflineHistory";
import { BotPendingMessages, useEditingBotOutbox } from "./BotPendingMessages";
import { useBotEnvironmentOnline } from "./botOfflineCache";
import { botChatCanvas, botMessageColors, useBotChatAppearance } from "./botChatAppearance";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { BotMessageActions } from "./BotMessageActions";
import { useBotGroupAttachments } from "./useBotGroupAttachments";
import { BotAttachmentList, useBotAttachmentPreview } from "./BotAttachmentPreview";
import { firstLargeBotAttachment } from "./bot-attachment-transfer";
import { FilePreviewModal } from "../../components/ui/FilePreviewModal";
import { Keyboard, Pressable, View } from "react-native";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import type { EnvironmentId, OpenbotChannelMessage } from "@t3tools/contracts";
import {
  OpenBotText as Text,
  OpenBotTypography,
  useOpenBotFont,
} from "./upstream/OpenBotTypography";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotGroupResponse } from "./BotGroupResponse";
import { useEnvironmentQuery } from "../../state/query";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { BotChannels } from "../settings/BotChannels";
import { BotDictation, useBotDictation } from "../settings/BotDictation";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useBotChannels } from "../settings/useBotChannels";
import { BotAvatar } from "./upstream/BotAvatar";
import {
  BotCodeButton,
  BotGlass,
  BotHeaderRow,
  BotIconButton,
  useBotPalette,
} from "./upstream/BotChrome";
import {
  BotMessageComposer,
  BotScrollToLatest,
  useBotKeyboardAvoidance,
} from "./upstream/BotMessageComposer";
import { GroupAvatar } from "./upstream/GroupAvatar";
import { useReturnToCode } from "./useReturnToCode";
import { chatDayLabels } from "./upstream/chat-day-markers";

type Host = { environmentId: EnvironmentId; hostId: string };
type Group = Host & { channelId: string; name?: string };
type VisibleGroupMessage = { item: OpenbotChannelMessage; isViewable: boolean };

export function BotGroupChatRoute({ route }: StaticScreenProps<Group>) {
  return <BotGroupChat key={JSON.stringify(route.params)} {...route.params} />;
}

export function BotGroupsRoute({
  route,
}: StaticScreenProps<Host & { channelId?: string; create?: boolean }>) {
  const navigation = useNavigation();
  const { environmentId, hostId, channelId, create } = route.params;
  return (
    <SettingsScreen title={create ? "New group chat" : "Group chats"}>
      <ScreenScrollView contentContainerClassName="gap-3 px-5 py-4">
        <BotChannels
          environmentId={environmentId}
          hostId={hostId}
          initialChannelId={channelId}
          createOnOpen={create}
          onCancelCreation={navigation.goBack}
          onCreated={(newChannelId, name) => {
            if (!navigation.isFocused()) return;
            navigation.dispatch(
              StackActions.replace("BotGroupChat", {
                environmentId,
                hostId,
                channelId: newChannelId,
                name,
              }),
            );
          }}
          defaultExpanded
        />
      </ScreenScrollView>
    </SettingsScreen>
  );
}

export function BotGroupChat(props: Group) {
  const online = useBotEnvironmentOnline(props.environmentId);
  const host = useEnvironmentQuery(
    online ? openbot.status({ environmentId: props.environmentId, input: {} }) : null,
  );
  const palette = useBotPalette();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  if (host.data?.state === "ready" && host.data.hostId === props.hostId) {
    return (
      <OpenBotTypography>
        <GroupConversation {...props} />
      </OpenBotTypography>
    );
  }
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: palette.canvas }}>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <BotHeaderRow>
        <BotIconButton label="Go back" icon="chevron.left" onPress={navigation.goBack} />
        <Text style={{ color: palette.text }}>{props.name ?? "Group chat"}</Text>
        <BotIconButton label="Retry connection" icon="arrow.clockwise" onPress={host.refresh} />
      </BotHeaderRow>
      {host.data?.state === "ready" ? (
        <Text accessibilityRole="alert" style={{ padding: 20, color: palette.muted }}>
          Reconnect to this group’s host.
        </Text>
      ) : (
        <OpenBotTypography>
          <BotOfflineHistory
            environmentId={props.environmentId}
            hostId={props.hostId}
            chat={{ kind: "group", id: props.channelId }}
            connecting={host.isPending}
          />
        </OpenBotTypography>
      )}
    </View>
  );
}

function GroupConversation({ environmentId, hostId, channelId, name }: Group) {
  const focused = useIsFocused();
  const editingQueued = useEditingBotOutbox({
    environmentId,
    hostId,
    chat: { kind: "group", id: channelId },
  });
  const c = useBotChannels(environmentId, hostId, Crypto.randomUUID, channelId, {
    watchActiveTasks: focused,
  });
  const returnToCode = useReturnToCode();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const composerBottomPadding = Math.max(insets.bottom, 10);
  const keyboardAvoidance = useBotKeyboardAvoidance(composerBottomPadding);
  const palette = useBotPalette();
  const appearance = useBotChatAppearance();
  const canvas = botChatCanvas(appearance, palette.scheme, palette.canvas);
  const outgoing = botMessageColors(appearance);
  const markdown = useMarkdownPreviewStyles();
  const inter = useOpenBotFont();
  const query = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const agents = useMemo(
    () => new Map(query.data?.map((agent) => [agent.id, agent])),
    [query.data],
  );
  const members = c.channel?.members ?? [];
  const attachments = useBotGroupAttachments(environmentId, hostId, channelId);
  const attachmentRecipient =
    attachments.agentId ?? c.recipient ?? c.channel?.leadAgentId ?? members[0]?.agentId;
  const attachmentRecipientAvailable = Boolean(
    attachmentRecipient && members.some((member) => member.agentId === attachmentRecipient),
  );

  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const hostCapabilities = settingsCapabilities(compatibility.data);
  const canRecoverGroupFiles = hostCapabilities.includes(
    OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
  );
  const canDeleteMessage = hostCapabilities.includes(OPENBOT_MESSAGE_DELETE_CAPABILITY);
  useRememberGroupChat(
    { environmentId, hostId, chat: { kind: "group", id: channelId } },
    c.channel?.id === channelId && c.activeTaskIds.size === 0 ? c.messages : null,
    canRecoverGroupFiles && attachmentRecipientAvailable && !c.channel?.archived
      ? attachmentRecipient
      : undefined,
  );

  const automaticDownloads = appearance.automaticLargeFiles && focused;
  const attachmentPreview = useBotAttachmentPreview(environmentId, hostId, automaticDownloads);
  const attachmentSource = (entry: OpenbotChannelMessage, attachmentId: string) => {
    const member =
      members.find(
        (candidate) => entry.author.kind === "agent" && candidate.agentId === entry.author.id,
      ) ?? members[0];
    return member && {
      agentId: member.agentId,
      source: {
        kind: "attachment" as const,
        channelId,
        messageId: entry.id,
        attachmentId,
        beforeSequence: entry.sequence + 1,
      },
    };
  };
  const visibleItems = useRef<readonly VisibleGroupMessage[]>([]);
  const prefetchView = useRef<(items: readonly VisibleGroupMessage[]) => void>(() => {});
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep FlatList's installed viewability callback stable while the current host scope changes.
  useLayoutEffect(() => {
    prefetchView.current = (items) => {
      if (!automaticDownloads) return;
      for (const { item, isViewable } of items) {
        if (!isViewable) continue;
        const file = firstLargeBotAttachment(item.message.attachments);
        if (!file) continue;
        const target = attachmentSource(item, file.id);
        if (target) attachmentPreview.prefetch(target.agentId, target.source, file.size);
      }
    };
    prefetchView.current(visibleItems.current);
  });
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: VisibleGroupMessage[] }) => {
      visibleItems.current = viewableItems;
      prefetchView.current(viewableItems);
    },
    [],
  );
  const disabled = !c.channel || c.channel.archived || c.busy || !c.canOperate;
  const voice = useBotDictation(
    JSON.stringify(["bot-group", environmentId, hostId, channelId]),
    c.text,
    c.setText,
    disabled,
  );
  const live = useBotLiveVoice({
    visible: focused && c.canOperate && !c.channel?.archived,
    available:
      !disabled && !voice.isBusy && !attachments.files.length && !c.reply && !c.text.trim(),
    scope: JSON.stringify([environmentId, hostId, channelId]),
    replyFor: (id) => groupBotVoiceReply(id, c.messages, c.tasks),
    send: c.sendVoice,
    interrupt: c.stopVoice,
  });
  const list = useRef<ComponentRef<typeof Animated.FlatList<OpenbotChannelMessage>>>(null);
  const follow = useRef(true);
  const listSize = useRef({ content: 0, viewport: 0 });
  const scrollToLatest = (animated = false) => {
    const { content, viewport } = listSize.current;
    if (viewport > 0)
      list.current?.scrollToOffset({ offset: Math.max(0, content - viewport), animated });
  };
  const [atLatest, setAtLatest] = useState(false);
  const timeOffset = useSharedValue(0);
  const showMessageActionButtons = useBotMessageActionButtons();
  const [actionsId, setActionsId] = useState<string | null>(null);
  const actionEntry = c.messages.find((entry) => entry.id === actionsId);
  const reading = useBotMessageReading(JSON.stringify([environmentId, hostId, channelId]));
  const readThrough = useRef(0);
  const labels = chatDayLabels(
    c.messages.map(({ id, message }) => ({ id, createdAt: message.createdAt })),
  );
  const reply = c.messages.find((entry) => entry.id === c.reply);
  const recipient = c.agents.find((agent) => agent.id === (attachments.agentId ?? c.recipient));
  const channelSummary = c.channels?.find((channel) => channel.id === channelId);
  const recordRead = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const markLatestRead = useEffectEvent((throughSequence: number) => {
    if (throughSequence <= readThrough.current) return;
    readThrough.current = throughSequence;
    void recordRead({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "channel.markRead",
          operationId: Crypto.randomUUID(),
          channelId,
          throughSequence,
        },
      },
    });
  });
  const unread = channelSummary?.unreadCount ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Match OpenBot: acknowledge messages when the focused chat is showing the latest history.
  useEffect(() => {
    if (focused && atLatest && unread > 0 && c.canSettings && !c.channel?.archived) {
      markLatestRead(c.throughSequence);
    }
  }, [focused, atLatest, unread, c.canSettings, c.channel?.archived, c.throughSequence]);

  const openInfo = () =>
    navigation.navigate("BotGroups", {
      environmentId,
      hostId,
      channelId,
    });
  const pull = useBotChatEndPull({
    enabled: focused && appearance.pullInfo && Boolean(c.channel) && !live.state && !voice.isBusy,
    onOpen: () => {
      Keyboard.dismiss();
      openInfo();
    },
    onNearLatest: (near, userScroll) => {
      if (userScroll) follow.current = near;
      setAtLatest(near);
    },
  });
  return (
    <Animated.View
      style={[{ flex: 1, paddingTop: insets.top, backgroundColor: canvas }, keyboardAvoidance]}
    >
      <FilePreviewModal {...attachmentPreview.modal} />
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <BotHeaderRow>
        <BotGlass>
          <BotIconButton label="Go back" icon="chevron.left" onPress={navigation.goBack} />
        </BotGlass>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Group info and tasks"
          onPress={openInfo}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <GroupAvatar members={members} agents={agents} size={38} />
          <Text
            numberOfLines={1}
            style={{ color: palette.text, flexShrink: 1, fontSize: 16, fontWeight: "600" }}
          >
            {c.channel?.name ?? name ?? "Group chat"}
          </Text>
        </Pressable>
        <BotCodeButton onPress={returnToCode} />
        <Menu
          actions={[
            { id: "info", title: "Group info and tasks" },
            { id: "refresh", title: "Refresh conversation", attributes: { disabled: c.busy } },
            ...(c.canManage && c.channel
              ? [
                  {
                    id: c.channel.archived ? "restore" : "archive",
                    title: c.channel.archived ? "Restore chat" : "Delete chat",
                    attributes: { destructive: !c.channel.archived, disabled: c.busy },
                  },
                ]
              : []),
            {
              id: "read",
              title: "Mark read",
              attributes: { disabled: !c.canSettings || !c.throughSequence || c.busy },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "info") openInfo();
            if (nativeEvent.event === "refresh") c.refresh();
            if (nativeEvent.event === "restore")
              void c.act({ operation: "channel.restore", channelId });
            if (nativeEvent.event === "archive")
              Dialog.confirm({
                title: "Delete this group chat?",
                message: "You can restore it from Deleted chats.",
                confirmText: "Delete chat",
                destructive: true,
                onConfirm: () => void c.act({ operation: "channel.archive", channelId }),
              });
            if (nativeEvent.event === "read")
              void c.act({
                operation: "channel.markRead",
                channelId,
                throughSequence: c.throughSequence,
              });
          }}
        >
          <BotGlass>
            <BotIconButton label="Group menu" icon="ellipsis" />
          </BotGlass>
        </Menu>
      </BotHeaderRow>
      {c.error && (
        <Text accessibilityRole="alert" style={{ color: palette.text, paddingHorizontal: 20 }}>
          {c.error}
        </Text>
      )}
      <Animated.FlatList
        ref={list}
        data={c.messages}
        keyExtractor={(entry) => entry.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        onContentSizeChange={(_width, height) => {
          listSize.current.content = height;
          if (follow.current) scrollToLatest();
        }}
        onLayout={({ nativeEvent }) => {
          listSize.current.viewport = nativeEvent.layout.height;
          if (follow.current) scrollToLatest();
        }}
        onScroll={pull.onScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        scrollEventThrottle={16}
        ListHeaderComponent={
          c.olderCursor === null ? undefined : (
            <Pressable
              accessibilityRole="button"
              disabled={c.busy}
              onPress={() => {
                follow.current = false;
                setAtLatest(false);
                void c.older();
              }}
            >
              <Text style={{ textAlign: "center", color: palette.muted }}>Earlier messages</Text>
            </Pressable>
          )
        }
        ListEmptyComponent={
          <Text style={{ textAlign: "center", color: palette.muted, marginTop: 32 }}>
            {c.loading
              ? "Loading conversation…"
              : c.channel
                ? "Start a conversation"
                : "This group is unavailable."}
          </Text>
        }
        renderItem={({ item: entry }) => {
          const { author, message } = entry;
          const streaming =
            author.kind === "agent" &&
            message.status === "streaming" &&
            entry.taskId !== null &&
            c.activeTaskIds.has(entry.taskId);
          if (
            message.status === "streaming" &&
            !streaming &&
            !message.text &&
            !message.attachments?.length
          )
            return null;
          const agent = author.kind === "agent" ? agents.get(author.id) : undefined;
          const ownSide = author.kind === "member";
          const foreground = (ownSide && outgoing?.text) || palette.text;
          const day = labels.get(entry.id);
          return (
            <View style={{ gap: 6 }}>
              {day && (
                <Text style={{ textAlign: "center", color: palette.muted, fontSize: 12 }}>
                  {day}
                </Text>
              )}
              <BotMessageSwipe
                own={ownSide}
                createdAt={message.createdAt}
                timeOffset={timeOffset}
                actions={showMessageActionButtons && !streaming && (
                  <BotIconButton
                    label="Message actions"
                    icon="ellipsis"
                    onPress={() => setActionsId(entry.id)}
                  />
                )}
                onReply={
                  disabled || streaming || attachments.busy || attachments.attempt
                    ? undefined
                    : () => c.setReply(entry.id)
                }
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    justifyContent: ownSide ? "flex-end" : "flex-start",
                    gap: 6,
                  }}
                >
                  {author.kind === "agent" && (
                    <BotAvatar
                      seed={agent?.avatarSeed ?? author.id}
                      hue={agent?.avatarHue}
                      size={30}
                    />
                  )}
                  <View
                    style={{
                      maxWidth: "84%",
                      alignItems: ownSide ? "flex-end" : "flex-start",
                      gap: 3,
                    }}
                  >
                    <Text style={{ color: palette.muted, fontSize: 12 }}>
                      {author.name}
                      {entry.superseded ? " · Earlier attempt" : ""}
                    </Text>
                    {author.kind === "agent" && appearance.showActivity && !!message.trace && (
                      <BotMessageActivity
                        key={JSON.stringify([environmentId, hostId, channelId, entry.id])}
                        scope={{ environmentId, hostId, channelId, messageId: entry.id }}
                        summary={message.trace}
                        deferred
                      />
                    )}
                    <Pressable
                      accessible={false}
                      onLongPress={streaming ? undefined : () => setActionsId(entry.id)}
                      style={
                        streaming && !message.text
                          ? undefined
                          : {
                              paddingVertical: 9,
                              paddingHorizontal: 12,
                              backgroundColor: ownSide
                                ? (outgoing?.fill ?? palette.control)
                                : palette.surface,
                              borderRadius: 18,
                              borderCurve: "continuous",
                            }
                      }
                    >
                      {streaming && !message.text && <BotTypingBubble />}
                      {message.text !== "" && (
                        <BotReplyMarkdown
                          body={message.text}
                          streaming={streaming}
                          visualPreviews={author.kind === "agent"}
                          onLinkPress={(url) => void tryOpenExternalUrl(url, "markdown-link")}
                          textStyle={{
                            ...markdown.nativeTextStyle,
                            fontFamily: inter ?? markdown.nativeTextStyle.fontFamily,
                            color: foreground,
                            strongColor: foreground,
                            ...(ownSide && outgoing ? { linkColor: foreground } : {}),
                            fontSize: 16,
                            lineHeight: 23,
                          }}
                        />
                      )}
                      <BotAttachmentList
                        value={message.attachments}
                        canOpen={attachmentPreview.canOpen && members.length > 0}
                        onOpen={(attachmentId) => {
                          const target = attachmentSource(entry, attachmentId);
                          if (target) void attachmentPreview.open(target.agentId, target.source);
                        }}
                      />
                      {channelSummary && message.uiBlock != null && (
                        <BotGroupResponse
                          environmentId={environmentId}
                          hostId={hostId}
                          channel={channelSummary}
                          entry={entry}
                          disabled={disabled}
                        />
                      )}
                      {message.status !== "completed" && message.status !== "streaming" && (
                        <Text style={{ color: palette.muted, fontSize: 12 }}>{message.status}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </BotMessageSwipe>
            </View>
          );
        }}
      />
      {actionEntry && (
        <BotMessageActions
          key={actionEntry.id}
          text={actionEntry.message.text}
          createdAt={actionEntry.message.createdAt}
          reading={reading.messageId === actionEntry.id}
          onReadAloud={
            reading.available &&
            actionEntry.author.kind === "agent" &&
            actionEntry.message.text &&
            actionEntry.message.status === "completed"
              ? () => reading.toggle(actionEntry.id, actionEntry.message.text)
              : undefined
          }
          onClose={() => setActionsId(null)}
          onReply={
            disabled || attachments.busy || attachments.attempt
              ? undefined
              : () => c.setReply(actionEntry.id)
          }
          onDelete={
            !canDeleteMessage ||
            disabled ||
            !c.canOperate ||
            c.channel?.archived ||
            actionEntry.message.author === "system" ||
            actionEntry.message.status === "streaming" ||
            (actionEntry.taskId !== null && c.activeTaskIds.has(actionEntry.taskId))
              ? undefined
              : () =>
                  void c.act({
                    operation: "channel.message.delete",
                    channelId,
                    messageId: actionEntry.id,
                  })
          }
        />
      )}

      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: composerBottomPadding,
          gap: 6,
        }}
      >
        {appearance.pullInfo && (
          <BotChatEndPullRing progress={pull.progress}>
            <GroupAvatar members={members} agents={agents} size={26} />
          </BotChatEndPullRing>
        )}
        <BotPendingMessages
          environmentId={environmentId}
          hostId={hostId}
          chat={{ kind: "group", id: channelId }}
          allowEditing={!live.state && !voice.isBusy}
        />
        {!atLatest && c.messages.length > 0 && (
          <BotScrollToLatest
            onPress={() => {
              follow.current = true;
              scrollToLatest(true);
            }}
          />
        )}
        {c.channel?.archived ? (
          <Text style={{ color: palette.muted }}>This group is archived.</Text>
        ) : c.channel && !editingQueued ? (
          <>
            {c.reply && (
              <Pressable
                accessibilityRole="button"
                disabled={attachments.busy || !!attachments.attempt}
                onPress={() => c.setReply(null)}
              >
                <Text numberOfLines={1} style={{ color: palette.muted }}>
                  Replying to {reply?.author.name ?? "an earlier message"} · Cancel
                </Text>
              </Pressable>
            )}
            {attachments.uploading && (
              <Text accessibilityRole="status" style={{ color: palette.muted }}>
                Attaching…
              </Text>
            )}
            {attachments.files.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {attachments.files.map(({ attachment }) => (
                  <Pressable
                    key={attachment.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove attachment ${attachment.name}`}
                    disabled={attachments.busy || Boolean(attachments.attempt)}
                    onPress={() => attachments.remove(attachment.id)}
                    style={{
                      backgroundColor: palette.control,
                      padding: 8,
                      borderRadius: 12,
                      maxWidth: "100%",
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: palette.text }}>
                      {attachment.name} ×
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {voice.isBusy && <BotDictation voice={voice} disabled={disabled} />}
            {live.state ? (
              <BotLiveVoiceBar live={live} name={c.channel?.name ?? name ?? "Group"} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                <Menu
                  actions={[
                    { id: "files", title: "Files" },
                    { id: "photos", title: "Photos" },
                    { id: "camera", title: "Camera" },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    const source = nativeEvent.event;
                    if (
                      !disabled &&
                      attachments.canAttach &&
                      attachmentRecipient &&
                      attachmentRecipientAvailable &&
                      (source === "files" || source === "photos" || source === "camera")
                    )
                      void attachments.pick(source, attachmentRecipient);
                  }}
                >
                  <BotGlass>
                    <BotIconButton
                      label="Add to group message"
                      icon="plus"
                      disabled={disabled || !attachments.canAttach || !attachmentRecipientAvailable}
                    />
                  </BotGlass>
                </Menu>
                <Menu
                  actions={[
                    { id: "auto", title: "Auto", state: c.recipient ? "off" : "on" },
                    ...members.flatMap(({ agentId }) => {
                      const agent = c.agents.find((candidate) => candidate.id === agentId);
                      return agent
                        ? [
                            {
                              id: "member:" + agentId,
                              title: agent.name,
                              state: c.recipient === agentId ? ("on" as const) : ("off" as const),
                            },
                          ]
                        : [];
                    }),
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (!attachments.busy && !attachments.files.length)
                      c.setRecipient(
                        nativeEvent.event === "auto"
                          ? null
                          : nativeEvent.event.slice("member:".length),
                      );
                  }}
                >
                  <BotGlass>
                    <BotIconButton
                      label={recipient ? "Send to " + recipient.name : "Choose recipient · Auto"}
                      icon="person.2"
                      disabled={attachments.busy || attachments.files.length > 0}
                    />
                  </BotGlass>
                </Menu>
                <BotMessageComposer
                  label="Message to group"
                  text={c.text}
                  onChangeText={c.setText}
                  editable={!disabled && !attachments.attempt && !voice.freezesEditor}
                  action="send"
                  actionDisabled={
                    disabled ||
                    attachments.busy ||
                    voice.blocksSubmission ||
                    (attachments.files.length > 0
                      ? !attachments.canSend || !attachmentRecipientAvailable
                      : !c.text.trim())
                  }
                  showVoiceControl={
                    !voice.isBusy &&
                    !disabled &&
                    !attachments.busy &&
                    !attachments.attempt &&
                    !attachments.files.length
                  }
                  voiceLabel={live.available ? "Start voice conversation" : undefined}
                  onDictate={
                    live.available
                      ? () => void live.start()
                      : voice.isAvailable
                        ? voice.start
                        : undefined
                  }
                  onAction={async (committedText) => {
                    follow.current = true;
                    Keyboard.dismiss();
                    if (!attachments.files.length) {
                      await c.send(committedText);
                    } else if (await attachments.send(committedText, c.reply)) {
                      c.setText("");
                      c.setReply(null);
                      c.refresh();
                    }
                    scrollToLatest(true);
                  }}
                />
              </View>
            )}
            {channelSummary?.unreadCount ? (
              <Text style={{ color: palette.muted, fontSize: 12 }}>
                {channelSummary.unreadCount} unread
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </Animated.View>
  );
}
