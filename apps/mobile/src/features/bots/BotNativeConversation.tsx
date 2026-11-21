import { useBotGptVoice } from "./upstream/voice/useBotGptVoice";
import { Button } from "../../components/ui/Button";
import { useBotMessagePins, useBotMessagePinsCapability } from "./BotPinnedMessages";
import { BotLiveVoiceBar } from "./upstream/voice/BotLiveVoiceBar";
import { useBotMessageReading } from "./upstream/voice/BotMessageReading";
import { directBotVoiceReply, useBotLiveVoice } from "./upstream/voice/useBotLiveVoice";
import { BotMessageActivity } from "./BotMessageActivity";
import { BotMessageNotes } from "./BotMessageNotes";
import { botMemoryRows, botSubagentRows } from "./bot-message-notes";
import { BotReplyMarkdown, BotTypingBubble } from "./BotReplyMotion";
import { BotChatEndPullRing, useBotChatEndPull } from "./BotChatEndPull";
import {
  BotMessageSwipe,
  useBotMessageActionButtons,
  type BotForwardGesture,
} from "./BotMessageSwipe";
import { BotChatContextSheet, useBotChatContext } from "./BotChatContext";
import { useRememberAgentChat } from "./BotOfflineHistory";
import { BotPendingMessages, useEditingBotOutbox } from "./BotPendingMessages";
import { botChatCanvas, botMessageColors, useBotChatAppearance } from "./botChatAppearance";
import { BotAvatar, botAvatarHeadColor } from "./upstream/BotAvatar";
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import {
  OPENBOT_MESSAGE_DELETE_CAPABILITY,
  type EnvironmentId,
} from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useEnvironmentQuery } from "../../state/query";
import { BotAttachmentList, useBotAttachmentPreview } from "./BotAttachmentPreview";
import {
  botBranchDividerAfterId,
  botBranchPointIds,
  botCanDeleteConversationMessage,
  botChildBranchesByMessage,
  decodeBotThreadBranches,
  type BotThreadBranch,
} from "./bot-branch-markers";
import { firstLargeBotAttachment } from "./bot-attachment-transfer";
import { FilePreviewModal } from "../../components/ui/FilePreviewModal";
import {
  botFileQuoteTarget,
  resolveBotQuotedFileSource,
} from "@t3tools/client-runtime/openbot/presentation";
import { botQuoteReference } from "@t3tools/client-runtime/openbot/presentation";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useAppActive } from "../../lib/appState";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import * as Dialog from "../../components/ui/Dialog";
import {
  botMessageSections,
  taskViews,
} from "@t3tools/client-runtime/openbot/presentation";
import { useBotConversationPanel } from "../settings/useBotConversationPanel";
import { BotConversationQueue } from "../settings/BotConversationQueue";
import { useBotFileUpload, type BotFilePicker } from "../settings/useBotFileUpload";
import { BotIncomingShareEnvironment } from "../sharing/BotIncomingShareEnvironment";
import { BotDictation, useBotDictation } from "../settings/BotDictation";
import { BotResponseBlock } from "../settings/BotResponseBlock";
import { normalizeConversationUiBlock } from "@t3tools/client-runtime/openbot/rich-conversation";
import { OpenBotText as Text, useOpenBotFont } from "./upstream/OpenBotTypography";
import { Menu } from "../../components/ui/Menu";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { BotGlass, BotIconButton, useBotPalette } from "./upstream/BotChrome";
import {
  BotMessageComposer,
  BotScrollToLatest,
  useBotKeyboardAvoidance,
} from "./upstream/BotMessageComposer";
import { chatDayLabels } from "./upstream/chat-day-markers";
import {
  BotMessageActions,
  BotMessageReactionPill,
  botMessageReactions,
  ownBotMessageReaction,
} from "./BotMessageActions";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  name?: string;
  taskId?: string | null;
  initialMessageId?: string | undefined;
  workspace?: boolean;
  visible?: boolean;
  avatarSeed?: string | undefined;
  avatarHue?: number | null | undefined;
  onFiles?: () => void;
  forwardGesture?: BotForwardGesture;
};
export function BotNativeConversation(props: Props) {
  return (
    <ConversationBody
      key={JSON.stringify([
        props.environmentId,
        props.hostId,
        props.agentId,
        props.taskId,
        props.initialMessageId,
      ])}
      {...props}
    />
  );
}
function ConversationBody({
  environmentId,
  hostId,
  agentId,
  name,
  taskId = null,
  initialMessageId,
  avatarSeed,
  avatarHue,
  onFiles,
  forwardGesture,
  visible = true,
}: Props) {
  const [anchor, setAnchor] = useState(initialMessageId);
  const positioned = useRef(false);
  const editingQueued = useEditingBotOutbox({
    environmentId,
    hostId,
    chat: { kind: "agent", id: agentId, taskId },
  });
  const c = useBotConversationPanel(
    environmentId,
    hostId,
    agentId,
    taskId,
    Crypto.randomUUID,
    visible,
    anchor,
  );
  useRememberAgentChat(
    { environmentId, hostId, chat: { kind: "agent", id: agentId, taskId } },
    !anchor && c.snapshot && !c.snapshot.activeTurnId ? c.snapshot.messages : null,
    c.snapshot?.threadId ?? null,
  );
  const { context, capabilities: contextCapabilities } = useBotChatContext({
    environmentId,
    hostId,
    agentId,
    threadId: visible ? (c.snapshot?.threadId ?? null) : null,
  });
  const [contextOpen, setContextOpen] = useState(false);
  const usage = context?.usage;
  const hasContextActions = usage || (!taskId && contextCapabilities.includes("context-reset-v1"));
  const contextShare = usage ? Math.min(1, usage.usedTokens / usage.windowTokens) : 0;
  const contextWarning = usage && contextShare >= (usage.autoCompactAt ?? 0.9) - 0.1;
  const fileUpload = useBotFileUpload(environmentId, hostId);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const actionMessage = c.messages.find((message) => message.id === actionsId);
  const canPin = useBotMessagePinsCapability(visible ? { environmentId, hostId } : null);
  const pins = useBotMessagePins({ environmentId, hostId, agentId }, canPin);
  const compatibilityQuery = useEnvironmentQuery(
    visible
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  const canDeleteMessage = settingsCapabilities(compatibilityQuery.data).includes(
    OPENBOT_MESSAGE_DELETE_CAPABILITY,
  );
  const branchesQuery = useEnvironmentQuery(
    visible
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "thread.branches", agentId } },
        })
      : null,
  );
  const tasksQuery = useEnvironmentQuery(
    visible
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "task.list", agentId } },
        })
      : null,
  );
  const branches = useMemo(
    () => decodeBotThreadBranches(branchesQuery.data),
    [branchesQuery.data],
  );
  const taskTitlesById = useMemo(
    () => new Map((taskViews(tasksQuery.data) ?? []).map((task) => [task.id, task.title])),
    [tasksQuery.data],
  );
  const currentBranch = useMemo(
    () => (taskId ? branches.find((branch) => branch.taskId === taskId) ?? null : null),
    [branches, taskId],
  );
  const branchPoints = useMemo(
    () => botBranchPointIds(c.messages, c.snapshot?.activeTurnId ?? null),
    [c.messages, c.snapshot?.activeTurnId],
  );
  const childBranchesByMessage = useMemo(
    () => botChildBranchesByMessage(branches, taskId),
    [branches, taskId],
  );
  const branchSourceLabel = useMemo(() => {
    if (!currentBranch) return null;
    if (currentBranch.sourceTaskId === null) return name ?? "Chat";
    return taskTitlesById.get(currentBranch.sourceTaskId) ?? currentBranch.sourceTitle;
  }, [currentBranch, name, taskTitlesById]);
  const selectedPinned = Boolean(
    pins.pins?.some((pin) => pin.taskId === taskId && pin.messageId === actionsId),
  );
  const reading = useBotMessageReading(JSON.stringify([environmentId, hostId, agentId, taskId]));
  const dayLabels = useMemo(() => chatDayLabels(c.messages), [c.messages]);
  const p = useBotPalette();
  const appearance = useBotChatAppearance();
  const branchDividerAfterId = useMemo(
    () =>
      currentBranch
        ? botBranchDividerAfterId(
            c.messages,
            currentBranch.throughMessageId,
            (message) =>
              (message.itemType === "subagents" && !appearance.showSubagents) ||
              (message.itemType === "memory-changes" && !appearance.showMemoryChanges),
          )
        : null,
    [c.messages, currentBranch, appearance.showSubagents, appearance.showMemoryChanges],
  );
  const canvas = botChatCanvas(appearance, p.scheme, p.canvas);
  const outgoing = botMessageColors(
    appearance,
    botAvatarHeadColor(avatarSeed ?? agentId, avatarHue),
  );
  const insets = useSafeAreaInsets();
  const composerBottomPadding = Math.max(insets.bottom, 10);
  const keyboardAvoidance = useBotKeyboardAvoidance(composerBottomPadding);
  const markdown = useMarkdownPreviewStyles();
  const inter = useOpenBotFont();
  const scroll = useRef<ScrollViewInstance>(null);
  const followLatest = useRef(!initialMessageId);
  const [atLatest, setAtLatest] = useState(true);
  const timeOffset = useSharedValue(0);
  const showMessageActionButtons = useBotMessageActionButtons();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const recordRead = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const readThrough = useRef<string | null>(null);
  const keepUnread = useRef(false);
  const readBoundary =
    c.snapshot?.agentId === agentId && !c.snapshot.activeTurnId
      ? c.snapshot.messages.at(-1)?.id
      : undefined;
  const markLatestRead = useEffectEvent(async (throughMessageId: string) => {
    if (keepUnread.current || readThrough.current === throughMessageId) return;
    readThrough.current = throughMessageId;
    const result = await recordRead({
      environmentId,
      input: {
        hostId,
        request: taskId
          ? { operation: "thread.markRead", agentId, taskId, throughMessageId }
          : { operation: "conversation.markRead", agentId, throughMessageId },
      },
    });
    if (result._tag === "Failure" && readThrough.current === throughMessageId)
      readThrough.current = null;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Only acknowledge the latest settled history while it is shown in the foreground.
  useEffect(() => {
    if (!focused || !visible) {
      keepUnread.current = false;
      readThrough.current = null;
      return;
    }
    if (appActive && atLatest && !anchor && !c.busy && c.permission && readBoundary)
      void markLatestRead(readBoundary);
  }, [focused, visible, appActive, atLatest, anchor, c.busy, c.permission, readBoundary]);
  const positions = useRef(new Map<string, number>());
  const positionAnchor = (y: number | undefined) => {
    if (!scroll.current || positioned.current || y === undefined) return;
    positioned.current = true;
    scroll.current.scrollTo({ y: Math.max(0, y - 24), animated: false });
  };
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(initialMessageId ?? null);
  const automaticDownloads = appearance.automaticLargeFiles && focused && visible;
  const attachmentPreview = useBotAttachmentPreview(environmentId, hostId, automaticDownloads);
  const visibleArea = useRef({ top: 0, height: 0 });
  const contentHeight = useRef(0);
  const fileLayouts = useRef(new Map<string, { y: number; height: number }>());
  const prefetchVisibleFiles = (top: number, height: number) => {
    visibleArea.current = { top, height };
    for (const message of c.messages) {
      const layout = fileLayouts.current.get(message.id);
      if (!layout || layout.y >= top + height || layout.y + layout.height <= top) continue;
      const file = firstLargeBotAttachment(message.attachments);
      if (file) attachmentPreview.prefetch(agentId, {
        kind: "attachment",
        messageId: message.id,
        attachmentId: file.id,
        ...(taskId ? { taskId } : {}),
      }, file.size);
    }
  };
  const resumeVisibleDownloads = useEffectEvent(() => {
    const { top, height } = visibleArea.current;
    if (height > 0) prefetchVisibleFiles(top, height);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Start a transfer for the current viewport when automatic downloads are enabled or the chat regains focus.
  useLayoutEffect(() => {
    if (automaticDownloads) resumeVisibleDownloads();
  }, [automaticDownloads]);
  const openQuote = async (id: string, text: string) => {
    const target = botFileQuoteTarget(id);
    if (target) {
      const source = resolveBotQuotedFileSource(
        target,
        [...c.messages, ...Object.values(c.references)],
        taskId,
      );
      if (!source) {
        Dialog.alert("Quoted attachment unavailable", text);
        return;
      }
      await attachmentPreview.open(agentId, source);
      return;
    }
    const y = positions.current.get(id);
    if (y === undefined) {
      Dialog.alert("Quoted passage", text);
      return;
    }
    followLatest.current = false;
    setHighlightedQuote(id);
    scroll.current?.scrollTo({ y: Math.max(0, y - 24), animated: false });
  };
  const [toolsOpen, setToolsOpen] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const voice = useBotDictation(
    JSON.stringify(["bot", environmentId, hostId, agentId, taskId]),
    c.text,
    c.setText,
    c.busy || Boolean(c.fileAttempt) || !c.permission,
  );
  const standardVoice = useBotLiveVoice({
    visible: visible && focused && c.permission,
    available:
      Boolean(c.snapshot) && !c.busy && !voice.isBusy && !c.selectedDraftId && !c.text.trim(),
    scope: JSON.stringify([environmentId, hostId, agentId, taskId]),
    replyFor: (id) =>
      directBotVoiceReply(
        id,
        c.messages,
        c.queue?.deliveries ?? [],
        c.snapshot?.activeTurnId ?? null,
      ),
    send: c.sendVoice,
    interrupt: (turnId) =>
      c.act(
        taskId
          ? { operation: "task.stop", agentId, taskId }
          : { operation: "conversation.stop", agentId, turnId },
      ),
  });
  const gptVoice = useBotGptVoice({
    environmentId,
    hostId,
    agentId,
    direct: !taskId,
    visible: visible && focused && c.permission,
    available:
      Boolean(c.snapshot) &&
      !c.busy &&
      !voice.isBusy &&
      !standardVoice.state &&
      !c.selectedDraftId &&
      !c.text.trim(),
  });
  const live = gptVoice.available || gptVoice.state ? gptVoice : standardVoice;
  const pull = useBotChatEndPull({
    onViewport: automaticDownloads ? prefetchVisibleFiles : undefined,
    enabled:
      focused &&
      visible &&
      appearance.pullInfo &&
      Boolean(c.snapshot) &&
      !live.state &&
      !voice.isBusy,
    onOpen: () => {
      Keyboard.dismiss();
      navigation.navigate("SettingsBotDetail", {
        environmentId,
        hostId,
        agentId,
        name: name ?? "Bot",
      });
    },
    onNearLatest: (near, userScroll) => {
      if (userScroll) followLatest.current = near;
      setAtLatest(near);
    },
  });
  const disabled = c.busy || !c.permission;
  const openBranch = async (messageId: string) => {
    const branch = await c.branch(messageId);
    if (!branch) return;
    branchesQuery.refresh();
    tasksQuery.refresh();
    if (!navigation.isFocused()) return;
    Keyboard.dismiss();
    const params = {
      environmentId,
      hostId,
      agentId,
      taskId: branch.id,
      title: branch.title,
      name: name ?? "Bot",
      avatarSeed,
      avatarHue,
    };
    navigation.dispatch(
      taskId === null
        ? StackActions.push("BotAgentThread", params)
        : StackActions.replace("BotAgentThread", params),
    );
  };
  const openExistingBranch = (branch: BotThreadBranch) => {
    Keyboard.dismiss();
    const params = {
      environmentId,
      hostId,
      agentId,
      taskId: branch.taskId,
      title: taskTitlesById.get(branch.taskId) || "Thread",
      name: name ?? "Bot",
      avatarSeed,
      avatarHue,
    };
    navigation.dispatch(
      taskId === null
        ? StackActions.push("BotAgentThread", params)
        : StackActions.replace("BotAgentThread", params),
    );
  };
  const openBranchSource = () => {
    if (!currentBranch || branchSourceLabel === null) return;
    Keyboard.dismiss();
    navigation.dispatch(
      StackActions.replace("BotAgentThread", {
        environmentId,
        hostId,
        agentId,
        taskId: currentBranch.sourceTaskId,
        title: branchSourceLabel,
        initialMessageId: currentBranch.sourceMessageId,
        name: name ?? "Bot",
        avatarSeed,
        avatarHue,
      }),
    );
  };
  const deleteMessage = async (messageId: string) => {
    const ok = await c.act({
      operation: "conversation.message.delete",
      agentId,
      taskId,
      messageId,
    });
    if (!ok) {
      Dialog.alert(
        "Could not delete message",
        "The host refused the request or the message is still running.",
      );
    }
  };
  const react = (messageId: string, emoji: string | null) =>
    c.act({ operation: "conversation.react", agentId, messageId, emoji });
  const canAttach =
    fileUpload.canUpload &&
    !fileUpload.busy &&
    !disabled &&
    !c.fileAttempt &&
    c.selectedDraftIds.length < 10;
  const attach = async (source: BotFilePicker) => {
    let draft: Awaited<ReturnType<typeof fileUpload.pick>> = null;
    try {
      draft = await fileUpload.pick(agentId, source);
    } catch {
      Dialog.alert(
        "Could not attach the file",
        "Try a supported file and check the host connection.",
      );
      return;
    }
    if (draft?.state === "ready") c.toggleDraft(draft.attachment.id);
  };
  const sendDisabled =
    fileUpload.busy ||
    c.busy ||
    voice.blocksSubmission ||
    (c.selectedDraftId ? !c.filePermission : !c.permission || !c.text.trim());
  const stopping = Boolean(c.snapshot?.activeTurnId && !c.text.trim());
  const stop = () =>
    void c.act(
      taskId
        ? { operation: "task.stop", agentId, taskId }
        : { operation: "conversation.stop", agentId, turnId: c.snapshot!.activeTurnId! },
    );
  return (
    <Animated.View style={[{ flex: 1, backgroundColor: canvas }, keyboardAvoidance]}>
      <FilePreviewModal {...attachmentPreview.modal} />
      {contextOpen && hasContextActions && (
        <BotChatContextSheet
          environmentId={environmentId}
          hostId={hostId}
          agentId={agentId}
          taskId={taskId}
          state={context}
          capabilities={contextCapabilities}
          turnActive={Boolean(c.snapshot?.activeTurnId)}
          onClose={() => setContextOpen(false)}
          onChanged={c.refresh}
        />
      )}
      <Animated.ScrollView
        ref={scroll}
        onTouchStart={() => setHighlightedQuote(null)}
        style={{ flex: 1 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={pull.onScroll}
        scrollEventThrottle={16}
        onLayout={({ nativeEvent }) => {
          const height = nativeEvent.layout.height;
          if (followLatest.current) scroll.current?.scrollToEnd({ animated: false });
          const top = followLatest.current
            ? Math.max(0, contentHeight.current - height)
            : visibleArea.current.top;
          visibleArea.current = { top, height };
          if (automaticDownloads && contentHeight.current > 0) prefetchVisibleFiles(top, height);
        }}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          if (anchor) {
            positionAnchor(positions.current.get(anchor));
            return;
          }
          if (followLatest.current) {
            scroll.current?.scrollToEnd({ animated: false });
            const viewportHeight = visibleArea.current.height;
            if (automaticDownloads && viewportHeight > 0)
              prefetchVisibleFiles(Math.max(0, height - viewportHeight), viewportHeight);
          }
        }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 20,
          gap: 20,
        }}
      >
        {c.snapshot?.threadId && (
          <BotIncomingShareEnvironment
            environmentId={environmentId}
            hostId={hostId}
            agentId={agentId}
            threadId={c.snapshot.threadId}
            taskId={taskId}
          />
        )}
        {c.loading && <Text style={{ fontSize: 14, color: p.muted }}>Loading conversation…</Text>}
        {c.error && (
          <Text accessibilityRole="alert" style={{ fontSize: 14, color: p.muted }}>
            {c.error}
          </Text>
        )}
        {c.hasOlder && !taskId && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              followLatest.current = false;
              void c.older();
            }}
          >
            <Text style={{ fontSize: 13, textAlign: "center", color: p.muted }}>
              Earlier messages
            </Text>
          </Pressable>
        )}
        {!c.loading && !c.messages.length && (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <Text style={{ fontSize: 16, color: p.muted }}>Start a conversation</Text>
          </View>
        )}
        {c.messages.map((message) => {
          const user = message.author === "user";
          const streaming =
            (message.author === "assistant" || message.author === "agent") &&
            message.status === "streaming";
          const foreground = (user && outgoing?.text) || p.text;
          const day = dayLabels.get(message.id);
          const reactions = botMessageReactions(message.reactions);
          if (
            (message.itemType === "subagents" && !appearance.showSubagents) ||
            (message.itemType === "memory-changes" && !appearance.showMemoryChanges)
          )
            return null;
          const workers = appearance.showSubagents ? botSubagentRows(message.subagents) : [];
          const memories = appearance.showMemoryChanges ? botMemoryRows(message.memoryChanges) : [];
          const deferredWorkers =
            appearance.showSubagents && message.deferredFields?.includes("subagents") === true;
          const deferredMemory =
            appearance.showMemoryChanges && message.deferredFields?.includes("memoryChanges") === true;
          const notes = !!(workers.length || memories.length || deferredWorkers || deferredMemory) && (
            <BotMessageNotes
              scope={{ environmentId, hostId, agentId, taskId, messageId: message.id }}
              agentName={name}
              workers={workers}
              memories={memories}
              deferredWorkers={deferredWorkers}
              deferredMemory={deferredMemory}
            />
          );
          if (
            (message.itemType === "subagents" && (workers.length || deferredWorkers)) ||
            (message.itemType === "memory-changes" && (memories.length || deferredMemory))
          ) {
            return <Fragment key={message.id}>{notes}</Fragment>;
          }
          const renderedForm = normalizeConversationUiBlock(message.uiBlock) !== null;
          const sections = botMessageSections(message).filter(
            (section) =>
              section.kind !== "reactions" &&
              section.kind !== "reaction" &&
              section.kind !== "attachments" &&
              section.kind !== "trace" &&
              section.kind !== "subagents" &&
              section.kind !== "memoryChanges" &&
              !(
                renderedForm &&
                (section.kind === "questionPrompt" || section.kind === "uiBlock")
              ) &&
              !["[]", "{}", "null", ""].includes(section.value.trim()),
          );
          return (
            <Fragment key={message.id}>
              {day && (
                <Text style={{ color: p.muted, fontSize: 12, textAlign: "center" }}>{day}</Text>
              )}
              <BotMessageSwipe
                own={user}
                createdAt={message.createdAt}
                timeOffset={timeOffset}
                forwardGesture={forwardGesture}
                onReply={!disabled && !streaming ? () => c.setReply(message.id) : undefined}
                actions={showMessageActionButtons && !streaming && (
                  <BotIconButton
                    label="Message actions"
                    icon="ellipsis"
                    onPress={() => setActionsId(message.id)}
                  />
                )}
                onLayout={({ nativeEvent }) => {
                  positions.current.set(message.id, nativeEvent.layout.y);
                  if (firstLargeBotAttachment(message.attachments)) {
                    fileLayouts.current.set(message.id, nativeEvent.layout);
                    const { top, height } = visibleArea.current;
                    if (automaticDownloads && height > 0) prefetchVisibleFiles(top, height);
                  }
                  if (message.id === anchor) positionAnchor(nativeEvent.layout.y);
                }}
              >
                <Pressable
                  accessible={false}
                  onLongPress={streaming ? undefined : () => setActionsId(message.id)}
                  style={{
                    borderStartWidth: highlightedQuote === message.id ? 2 : 0,
                    borderColor: p.muted,
                    gap: 6,
                  }}
                >
                  {notes}
                  {!user &&
                    appearance.showActivity &&
                    (message.trace || message.deferredFields?.includes("trace")) && (
                      <BotMessageActivity
                        scope={{ environmentId, hostId, agentId, taskId, messageId: message.id }}
                        summary={message.trace}
                        deferred={message.deferredFields?.includes("trace") ?? false}
                      />
                    )}
                  <View
                    style={
                      user
                        ? {
                            backgroundColor: outgoing?.fill ?? p.control,
                            borderRadius: 20,
                            borderCurve: "continuous",
                            paddingHorizontal: 14,
                            paddingVertical: 11,
                          }
                        : undefined
                    }
                  >
                    {message.replyToMessageId && (
                      <Text
                        numberOfLines={2}
                        style={{ fontSize: 13, color: foreground, opacity: 0.8, marginBottom: 6 }}
                      >
                        {(
                          c.messages.find((m) => m.id === message.replyToMessageId) ??
                          c.references[message.replyToMessageId]
                        )?.text.slice(0, 200) ?? "Reply"}
                      </Text>
                    )}
                    {streaming && !message.text && <BotTypingBubble />}
                    {!!message.text && (
                      <BotReplyMarkdown
                        body={message.text}
                        streaming={streaming}
                        visualPreviews={!user}
                        linkCustomization={(url) => {
                          const quote = botQuoteReference(url);
                          return quote
                            ? { label: quote.text.replace(/\s+/gu, " "), chip: { tintsIcon: true } }
                            : undefined;
                        }}
                        onLinkPress={(url) => {
                          const quote = botQuoteReference(url);
                          if (quote) void openQuote(quote.id, quote.text);
                          else void tryOpenExternalUrl(url, "markdown-link");
                        }}
                        textStyle={{
                          ...markdown.nativeTextStyle,
                          fontFamily: inter ?? markdown.nativeTextStyle.fontFamily,
                          color: foreground,
                          strongColor: foreground,
                          ...(user && outgoing ? { linkColor: foreground } : {}),
                          fontSize: 16,
                          lineHeight: 23,
                        }}
                      />
                    )}
                    <BotAttachmentList
                      value={message.attachments}
                      canOpen={attachmentPreview.canOpen}
                      onOpen={(attachmentId) =>
                        void attachmentPreview.open(agentId, {
                          kind: "attachment",
                          messageId: message.id,
                          attachmentId,
                          ...(taskId ? { taskId } : {}),
                        })
                      }
                    />
                    {sections.length > 0 && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setDetails(details === message.id ? null : message.id)}
                      >
                        <Text style={{ fontSize: 13, color: p.muted, marginTop: 6 }}>
                          {sections.map((s) => s.kind).join(" · ")}
                        </Text>
                      </Pressable>
                    )}
                    {details === message.id &&
                      sections.map((section) => (
                        <Text
                          key={section.kind}
                          selectable
                          style={{ fontSize: 13, color: p.muted, marginTop: 6 }}
                        >
                          {section.value}
                        </Text>
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
                    <BotMessageReactionPill
                      reactions={reactions}
                      ownMessage={user}
                      onRemove={
                        disabled || taskId || message.status === "streaming"
                          ? undefined
                          : () => void react(message.id, null)
                      }
                    />
                  </View>
                </Pressable>
              </BotMessageSwipe>
              {childBranchesByMessage.get(message.id)?.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: -10 }}>
                  {childBranchesByMessage.get(message.id)!.map((branch) => {
                    const label = taskTitlesById.get(branch.taskId) || "Thread";
                    return (
                      <Pressable
                        key={branch.taskId}
                        accessibilityRole="link"
                        accessibilityLabel={`Open branch ${label}`}
                        onPress={() => openExistingBranch(branch)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: p.surface,
                          opacity: pressed ? 0.65 : 1,
                        })}
                      >
                        <SymbolView name="arrow.branch" tintColor={p.muted} size={12} />
                        <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, maxWidth: 220 }}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {branchDividerAfterId === message.id && currentBranch ? (
                <BotBranchDivider
                  label={branchSourceLabel}
                  muted={p.muted}
                  onOpen={branchSourceLabel !== null ? openBranchSource : undefined}
                />
              ) : null}
            </Fragment>
          );
        })}
        {c.snapshot?.activeTurnId &&
          !c.messages.some(
            (message) =>
              (message.author === "assistant" || message.author === "agent") &&
              message.status === "streaming",
          ) && <BotTypingBubble />}
      </Animated.ScrollView>
      {actionMessage && (
        <BotMessageActions
          key={actionMessage.id}
          text={actionMessage.text}
          createdAt={actionMessage.createdAt}
          reading={reading.messageId === actionMessage.id}
          onReadAloud={
            reading.available &&
            (actionMessage.author === "assistant" || actionMessage.author === "agent") &&
            actionMessage.text &&
            actionMessage.status === "completed"
              ? () => reading.toggle(actionMessage.id, actionMessage.text)
              : undefined
          }
          ownReaction={ownBotMessageReaction(actionMessage.reactions)}
          pinAction={
            pins.canWrite &&
            actionMessage.author !== "system" &&
            actionMessage.status === "completed"
              ? {
                  pinned: selectedPinned,
                  run: () => void pins.setPinned(taskId, actionMessage.id, !selectedPinned),
                }
              : undefined
          }
          onClose={() => setActionsId(null)}
          onReply={disabled ? undefined : () => c.setReply(actionMessage.id)}
          onBranch={
            disabled ||
            Boolean(c.snapshot?.activeTurnId) ||
            !branchPoints.has(actionMessage.id)
              ? undefined
              : () => void openBranch(actionMessage.id)
          }
          onReact={
            disabled || taskId || actionMessage.status === "streaming"
              ? undefined
              : (emoji) => void react(actionMessage.id, emoji)
          }
          onDelete={
            !canDeleteMessage ||
            disabled ||
            !botCanDeleteConversationMessage(actionMessage, c.snapshot?.activeTurnId ?? null)
              ? undefined
              : () => void deleteMessage(actionMessage.id)
          }
        />
      )}
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: composerBottomPadding,
          gap: 8,
        }}
      >
        {appearance.pullInfo && (
          <BotChatEndPullRing progress={pull.progress}>
            <BotAvatar seed={avatarSeed ?? agentId} hue={avatarHue} size={26} />
          </BotChatEndPullRing>
        )}
        <BotPendingMessages
          environmentId={environmentId}
          hostId={hostId}
          chat={{ kind: "agent", id: agentId, taskId }}
          allowEditing={!live.state && !voice.isBusy}
        />
        {anchor && (
          <Button
            label="Back to latest messages"
            onPress={() => {
              followLatest.current = true;
              setHighlightedQuote(null);
              setAnchor(undefined);
            }}
          />
        )}
        {!anchor && !atLatest && c.messages.length > 0 && (
          <BotScrollToLatest
            onPress={() => {
              followLatest.current = true;
              scroll.current?.scrollToEnd({ animated: true });
            }}
          />
        )}
        {!editingQueued && (
          <>
            {c.reply && (
              <Pressable accessibilityRole="button" onPress={() => c.setReply(null)}>
                <Text style={{ fontSize: 13, color: p.muted, paddingHorizontal: 12 }}>
                  Replying · Cancel
                </Text>
              </Pressable>
            )}
            {toolsOpen && (
              <ScrollView
                style={{
                  maxHeight: 220,
                  backgroundColor: p.surface,
                  borderRadius: 20,
                  padding: 12,
                }}
                keyboardShouldPersistTaps="handled"
              >
                <Pressable onPress={() => c.setSelectedDraftId(null)}>
                  <Text style={{ color: p.text, padding: 8 }}>Clear file selection</Text>
                </Pressable>
                {c.fileDrafts.map((d) => (
                  <Pressable
                    key={d.attachment.id}
                    disabled={
                      c.busy ||
                      Boolean(c.fileAttempt) ||
                      (c.selectedDraftIds.length >= 10 &&
                        !c.selectedDraftIds.includes(d.attachment.id))
                    }
                    onPress={() => c.toggleDraft(d.attachment.id)}
                  >
                    <Text style={{ color: p.text, padding: 8 }}>
                      {c.selectedDraftIds.includes(d.attachment.id) ? "✓ " : ""}
                      {d.attachment.name} · {d.state}
                    </Text>
                  </Pressable>
                ))}
                <BotConversationQueue controller={c} agentId={agentId} />
              </ScrollView>
            )}
            {fileUpload.busy && (
              <Text accessibilityRole="status" style={{ color: p.muted }}>
                Attaching…
              </Text>
            )}
            {c.selectedDraftIds.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {c.fileDrafts
                  .filter((draft) => c.selectedDraftIds.includes(draft.attachment.id))
                  .map(({ attachment }) => (
                    <Pressable
                      key={attachment.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove attachment ${attachment.name}`}
                      disabled={Boolean(c.fileAttempt) || c.busy || fileUpload.busy}
                      onPress={() => c.toggleDraft(attachment.id)}
                      style={{
                        backgroundColor: p.control,
                        padding: 8,
                        borderRadius: 12,
                        maxWidth: "100%",
                      }}
                    >
                      <Text numberOfLines={1} style={{ color: p.text }}>
                        {attachment.name} ×
                      </Text>
                    </Pressable>
                  ))}
              </View>
            )}
            {voice.isBusy && <BotDictation voice={voice} disabled={disabled} />}
            {live.state ? (
              <BotLiveVoiceBar live={live} name={name ?? "Bot"} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                <Menu
                  actions={[
                    { id: "attach-files", title: "Files", attributes: { disabled: !canAttach } },
                    { id: "attach-photos", title: "Photos", attributes: { disabled: !canAttach } },
                    { id: "attach-camera", title: "Camera", attributes: { disabled: !canAttach } },
                    ...(onFiles ? [{ id: "files", title: "Browse bot files" }] : []),
                    ...(hasContextActions
                      ? [
                          {
                            id: "context",
                            title: usage
                              ? `Context · ${Math.round(contextShare * 100)}% used`
                              : "Context",
                          },
                        ]
                      : []),
                    {
                      id: "queue",
                      title: toolsOpen ? "Hide attachments and queue" : "Attachments and queue",
                    },
                    { id: "refresh", title: "Refresh conversation" },
                    {
                      id: "read",
                      title: "Mark read",
                      attributes: { disabled: disabled || !c.messages.length },
                    },
                    ...(!taskId
                      ? [{ id: "unread", title: "Mark unread", attributes: { disabled } }]
                      : []),
                    ...(voice.isAvailable
                      ? [{ id: "dictate", title: "Dictate message", attributes: { disabled } }]
                      : []),
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    const id = nativeEvent.event;
                    if (id === "attach-files") void attach("files");
                    if (id === "attach-photos") void attach("photos");
                    if (id === "attach-camera") void attach("camera");
                    if (id === "files") onFiles?.();
                    if (id === "context") setContextOpen(true);
                    if (id === "queue") setToolsOpen(!toolsOpen);
                    if (id === "refresh") c.refresh();
                    if (id === "dictate") voice.start();
                    if (id === "unread") {
                      keepUnread.current = true;
                      void c.act({ operation: "conversation.markUnread", agentId }).then((marked) => {
                        if (!marked) keepUnread.current = false;
                      });
                    }
                    if (id === "read") {
                      const throughMessageId = c.messages.at(-1)?.id;
                      if (throughMessageId)
                        void c.act(
                          taskId
                            ? { operation: "thread.markRead", agentId, taskId, throughMessageId }
                            : { operation: "conversation.markRead", agentId, throughMessageId },
                        );
                    }
                  }}
                >
                  <BotGlass>
                    <BotIconButton label="Add to message" icon="plus" />
                    {contextWarning && (
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 9,
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: "#f59e0b",
                        }}
                      />
                    )}
                  </BotGlass>
                </Menu>
                <BotMessageComposer
                  label="Message to bot"
                  text={c.text}
                  onChangeText={c.setText}
                  editable={!c.fileAttempt && !voice.freezesEditor}
                  action={stopping ? "stop" : "send"}
                  actionDisabled={stopping ? disabled : sendDisabled}
                  onAction={(committedText) => (stopping ? stop() : c.send(committedText))}
                  showVoiceControl={
                    !voice.isBusy && !disabled && !fileUpload.busy && !c.selectedDraftId
                  }
                  voiceLabel={live.available ? "Start voice conversation" : undefined}
                  onDictate={
                    live.available
                      ? () => void live.start()
                      : voice.isAvailable
                        ? voice.start
                        : undefined
                  }
                />
              </View>
            )}
          </>
        )}
      </View>
    </Animated.View>
  );
}

function BotBranchDivider({
  label,
  muted,
  onOpen,
}: {
  label: string | null;
  muted: string;
  onOpen: (() => void) | undefined;
}) {
  const text = label === null ? "Branched from a deleted thread" : `Branched from ${label}`;
  const content = (
    <>
      <View style={{ height: 1, flex: 1, backgroundColor: muted, opacity: 0.35 }} />
      <SymbolView name="arrow.branch" tintColor={muted} size={13} />
      <Text numberOfLines={1} style={{ color: muted, fontSize: 12, flexShrink: 1 }}>
        {text}
      </Text>
      <View style={{ height: 1, flex: 1, backgroundColor: muted, opacity: 0.35 }} />
    </>
  );
  if (label === null || !onOpen) {
    return (
      <View
        accessible
        accessibilityLabel={text}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingTop: 6,
          paddingBottom: 2,
        }}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={text}
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: 6,
        paddingBottom: 2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}
