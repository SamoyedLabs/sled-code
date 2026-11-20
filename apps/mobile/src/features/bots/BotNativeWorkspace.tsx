import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import {
  GlassCapsule,
  GLASS_CAPSULE_HEIGHT,
} from "./upstream/openbot-mobile/shared/components/glass-capsule";
import { typeScale } from "./upstream/openbot-mobile/shared/lib/type-scale";
import { useLiquidGlass } from "./upstream/openbot-mobile/shared/lib/use-liquid-glass";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  Easing,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
} from "react-native-reanimated";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { BotVault } from "../settings/BotVault";
import {
  type ComponentProps,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Keyboard, Pressable, ScrollView, TextInput, View, type ViewInstance } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { isCommittedRightSwipe } from "./bots-edge-gesture";
import { useBotChatAppearance } from "./botChatAppearance";
import { BotOfflineHistory } from "./BotOfflineHistory";
import { useBotCachedValue, useBotEnvironmentOnline, useBotOfflineScope } from "./botOfflineCache";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OpenbotAgent, OpenbotChannelSummary, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { OpenBotText as Text, useOpenBotFont } from "./upstream/OpenBotTypography";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import {
  BotHiddenChats,
  BotRosterGroups,
  requestBotRosterSection,
  type BotRosterPresentation,
} from "./BotRosterGroups";
import type { RosterDragScroll } from "./BotRosterDrag";
import {
  botRosterItemKey,
  useBotRosterOrganization,
  type BotRosterPin,
} from "./useBotRosterOrganization";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotComputerDrawer } from "./BotComputerDrawer";
import { useBotLibraryAvailability } from "./BotLibrary";
import { BotRosterLoading } from "./BotRosterLoading";
import { BOT_ROSTER_ORDERS, BOT_ROSTER_ORDER_LABELS } from "./bot-roster-order";
import { BotWorkspaceConnection } from "./BotWorkspaceConnection";
import { BotWorkspaceUpdate } from "./BotWorkspaceUpdate";
import { botRosterState, botRosterWaits, resolveRosterEnvironment } from "./bot-roster-state";
import { BotRosterAvatarBadge, BotRosterWaitChip, botRosterStatusLabel } from "./BotRosterRowStatus";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { BotNativeConversation } from "./BotNativeConversation";
import { useBotMessagePinsCapability } from "./BotPinnedMessages";
import { channelList } from "@t3tools/client-runtime/openbot/presentation";
import { GroupAvatar } from "./upstream/GroupAvatar";
import { BotDeletedChats } from "./BotDeletedChats";
import { BotAvatar } from "./upstream/BotAvatar";
import {
  BotCodeButton,
  BotGlass,
  BotHeaderRow,
  BotIconButton,
  useBotPalette,
} from "./upstream/BotChrome";
import { BotFilesWorkspace as BotFiles } from "../settings/BotFiles";
import { BotBrowserWorkspace as BotBrowser } from "../settings/BotBrowser";
import { ComputerEnvironment } from "../settings/ComputerEnvironment";
import { DataEnvironment } from "../settings/DataEnvironment";
import { BotAttention } from "../settings/BotAttention";
import { BotChannels } from "../settings/BotChannels";
import { BotChannelExtras } from "../settings/BotChannelExtras";
import { BotWorkflows } from "../settings/BotWorkflows";
import { BotEvents } from "./BotEvents";
import { BotUsageLimitsButton } from "./BotUsageLimits";
import { BotRoutineFlows } from "./BotRoutineFlows";
import { recordBotShortcut, updateBotShortcutRoster } from "../shortcuts/botQuickActionsRuntime";
import { useBotMotion } from "./botFeedback";

export type BotSelection = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  name: string;
  avatarSeed?: string;
  avatarHue?: number | null;
};
let lastSelection: BotSelection | null = null;
let lastRosterEnvironmentId: EnvironmentId | null = null;
function setLastSelection(next: BotSelection | null) {
  lastSelection = next;
}
function setLastRosterEnvironmentId(environmentId: EnvironmentId) {
  lastRosterEnvironmentId = environmentId;
}
const BotRosterCache = Schema.Struct({
  hostId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  agents: Schema.Array(OpenbotAgent).check(Schema.isMaxLength(512)),
  channels: Schema.Array(OpenbotChannelSummary).check(Schema.isMaxLength(512)),
});
type BotRosterCache = typeof BotRosterCache.Type;
const decodeRoster = Schema.decodeUnknownOption(BotRosterCache);
function decodeBotRosterCache(value: unknown) {
  const decoded = decodeRoster(value);
  return decoded._tag === "Some" ? decoded.value : null;
}
const KEYBOARD_GAP = 8;
// oxlint-disable-next-line t3code/no-mobile-pull-request-glyph-literals -- This is OpenBot's stacked computers control.
const COMPUTERS_ICON = "square.3.layers.3d";
const SEARCH_FIELD_LAYOUT = LinearTransition.duration(340)
  .easing(Easing.bezier(0.32, 0.72, 0, 1))
  .reduceMotion(ReduceMotion.System);
type Tool =
  | "Chat"
  | "Files"
  | "Browser"
  | "Computer"
  | "Data"
  | "Vault"
  | "Channels"
  | "Workflows"
  | "Attention";
const toolNames: Tool[] = [
  "Files",
  "Browser",
  "Computer",
  "Vault",
  "Data",
  "Channels",
  "Workflows",
  "Attention",
];

export function BotNativeWorkspace({
  openRoster,
  initialSelection,
  onReturnToCode: code,
  drawerOpen,
  onDrawerOpenChange,
  onDirectChatOpenChange,
  quickAction,
  showHiddenChats,
}: {
  openRoster: boolean;
  initialSelection?: BotSelection | undefined;
  onReturnToCode: () => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  onDirectChatOpenChange: (open: boolean) => void;
  quickAction?: "search";
  showHiddenChats?: boolean;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const p = useBotPalette();
  const { environments, isReady } = useEnvironments();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    initialSelection?.environmentId ?? lastRosterEnvironmentId,
  );
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, "environment retry");
  const enableEnvironment = useAtomCommand(environmentCatalog.setEnabled, "enable environment");
  const [selection, setSelection] = useState(openRoster ? null : initialSelection ?? lastSelection);
  const [tool, setToolState] = useState<Tool>("Chat");
  const directChatOpen = selection !== null && tool === "Chat";
  const canOpenPins = useBotMessagePinsCapability(directChatOpen ? selection : null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Only the visible direct chat owns its inward Threads swipe.
  useLayoutEffect(
    () => onDirectChatOpenChange(directChatOpen),
    [directChatOpen, onDirectChatOpenChange],
  );
  const setTool = (next: Tool) => {
    Keyboard.dismiss();
    setToolState(next);
  };
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const endSearch = () => {
    Keyboard.dismiss();
    setSearchOpen(false);
    setSearch("");
  };
  const liquidGlass = useLiquidGlass();
  const fontFamily = useOpenBotFont();
  const bottomSearchGap = Math.max(insets.bottom - 8, 12);
  const rosterScroll = useRef<KeyboardAwareScrollViewRef>(null);
  const rosterViewport = useRef<ViewInstance>(null);
  const dragViewport = useRef({ height: 0, content: 0, offset: 0 });
  const [rosterDragging, setRosterDragging] = useState(false);
  const rosterDragScroll: RosterDragScroll = {
    bounds: () => {
      const rect = rosterViewport.current?.getBoundingClientRect();
      return rect
        ? { top: rect.y, bottom: rect.y + rect.height - bottomSearchGap - GLASS_CAPSULE_HEIGHT }
        : { top: 0, bottom: 0 };
    },
    by: (delta) => {
      const state = dragViewport.current;
      const offset = Math.max(0, Math.min(state.content - state.height, state.offset + delta));
      if (Math.abs(offset - state.offset) < 0.5) return false;
      state.offset = offset;
      rosterScroll.current?.scrollTo({ y: offset, animated: false });
      return true;
    },
    setDragging: setRosterDragging,
  };
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const searchAnimation = useBotMotion("searchTransitions");
  // OpenBot's search moves with the keyboard frame and stays eight points above it.
  const searchBarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -Math.max(0, Math.abs(keyboardHeight.get()) - (bottomSearchGap - KEYBOARD_GAP)),
      },
    ],
  }));
  const choose = (next: BotSelection | null) => {
    endSearch();
    setLastSelection(next);
    if (next) {
      selectEnvironment(next.environmentId);
      recordBotShortcut(next);
    }
    setSelection(next);
    setTool("Chat");
  };
  const selectEnvironment = (environmentId: EnvironmentId) => {
    setLastRosterEnvironmentId(environmentId);
    setSelectedEnvironmentId(environmentId);
  };
  const primary = resolveRosterEnvironment(environments, selectedEnvironmentId);
  // Keep the default computer selected while it disconnects, even when another computer is online.
  if (primary && primary.environmentId !== selectedEnvironmentId)
    setSelectedEnvironmentId(primary.environmentId);
  const openServerSettings = () => {
    navigation.navigate(
      "SettingsBots",
      primary ? { environmentId: primary.environmentId } : undefined,
    );
  };
  const connected = primary?.connection.phase === "connected";
  const paused = primary?.entry.enabled === false;
  const host = useEnvironmentQuery(
    primary && connected
      ? openbot.status({ environmentId: primary.environmentId, input: {} })
      : null,
  );
  const roster = botRosterState({
    catalogReady: isReady,
    connection: primary?.connection.phase,
    host: host.data,
    hostError: Boolean(host.error),
  });
  const hostId = connected && host.data?.state === "ready" ? host.data.hostId : null;
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(showHiddenChats === true);
  const closeHiddenToSettings = useRef(showHiddenChats === true);
  const closeHidden = () => {
    setHiddenOpen(false);
    if (closeHiddenToSettings.current) {
      closeHiddenToSettings.current = false;
      navigation.goBack();
    }
  };
  const hostScope = primary && hostId ? { environmentId: primary.environmentId, hostId } : null;
  const libraryAvailable = useBotLibraryAvailability(hostScope);
  const compatibility = useEnvironmentQuery(
    hostScope
      ? openbot.readFromHost({
          environmentId: hostScope.environmentId,
          input: { hostId: hostScope.hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const groupsAvailable = capabilities.includes("channel-chats-v1");
  const marketplaceAvailable = capabilities.includes("sled-public-catalog-v1");
  const openMarketplace = () => {
    if (hostScope && marketplaceAvailable)
      navigation.navigate("BotWorkspaceUtility", { ...hostScope, page: "marketplace" });
  };
  const openLibrary = () => {
    if (!hostScope || !libraryAvailable) return;
    endSearch();
    onDrawerOpenChange(false);
    navigation.navigate("BotLibrary", hostScope);
  };
  const cacheScope = useBotOfflineScope(primary?.environmentId ?? null);
  const offlineRoster = useBotCachedValue({
    scope: !connected ? cacheScope : null,
    name: "roster",
    live: null,
    decode: decodeBotRosterCache,
  });
  const loading = !selection && roster === "loading" && !offlineRoster;
  const noServers = !selection && roster === "empty";
  const searchIdle = searchOpen && !search.trim();
  const shortcuts: { title: string; icon: AppSymbolName; go: () => void }[] = [];
  if (primary && hostId) {
    const scope = { environmentId: primary.environmentId, hostId };
    shortcuts.push(
      {
        title: "Routines",
        icon: "calendar.badge.clock",
        go: () => navigation.navigate("BotWorkspaceUtility", { ...scope, page: "routines" }),
      },
      {
        title: "Usage",
        icon: "chart.bar.xaxis",
        go: () => navigation.navigate("BotWorkspaceUtility", { ...scope, page: "usage" }),
      },
    );
  }
  if (marketplaceAvailable)
    shortcuts.push({ title: "Marketplace", icon: "sparkles", go: openMarketplace });
  if (libraryAvailable)
    shortcuts.push({ title: "Library", icon: "square.grid.2x2", go: openLibrary });
  if (primary)
    shortcuts.push({
      title: "Server settings",
      icon: "slider.horizontal.3",
      go: openServerSettings,
    });
  if (primary && hostId)
    shortcuts.push({
      title: "Add agent",
      icon: "plus",
      go: () =>
        navigation.navigate("SettingsBotNew", { environmentId: primary.environmentId, hostId }),
    });
  shortcuts.push({
    title: "Settings",
    icon: "gearshape",
    go: () => navigation.navigate("Settings"),
  });

  return (
    <BotComputerDrawer
      open={drawerOpen}
      onOpenChange={onDrawerOpenChange}
      canOpen={!selection && (!searchOpen || noServers) && !loading}
      onAdd={() => {
        onDrawerOpenChange(false);
        navigation.navigate("SettingsEnvironmentNew");
      }}
      onManage={() => {
        onDrawerOpenChange(false);
        navigation.navigate("Settings");
      }}
      onSelect={(environmentId) => {
        selectEnvironment(environmentId);
        onDrawerOpenChange(false);
      }}
      onLibrary={libraryAvailable ? openLibrary : undefined}
      activeId={primary?.environmentId}
      environments={environments}
    >
      <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        {!loading && (!searchOpen || selection || noServers) && (
          <BotHeaderRow>
            {selection && (
              <BotGlass>
                <BotIconButton
                  label={tool === "Chat" ? "All chats" : "Back to conversation"}
                  icon="chevron.left"
                  onPress={() => (tool === "Chat" ? choose(null) : setTool("Chat"))}
                />
              </BotGlass>
            )}
            {selection ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Menu
                  actions={[
                    { id: "threads", title: "Threads" },
                    { id: "info", title: "Bot info" },
                    { id: "code", title: "Return to Code" },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (nativeEvent.event === "code") code();
                    else if (nativeEvent.event === "threads")
                      navigation.navigate("BotThreads", selection);
                    else navigation.navigate("SettingsBotDetail", selection);
                  }}
                >
                  <BotGlass>
                    <View
                      style={{
                        height: 44,
                        paddingHorizontal: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <BotAvatar
                        seed={selection.avatarSeed ?? selection.agentId}
                        hue={selection.avatarHue}
                        size={28}
                        animateFace
                      />
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 16, fontWeight: "600", color: p.text, flexShrink: 1 }}
                      >
                        {tool === "Chat" ? selection.name : tool}
                      </Text>
                    </View>
                  </BotGlass>
                </Menu>
              </View>
            ) : (
              <>
                <BotGlass>
                  <BotIconButton
                    label="Computers"
                    icon={COMPUTERS_ICON}
                    onPress={() => onDrawerOpenChange(true)}
                  />
                </BotGlass>
                {primary && !connected ? (
                  <BotWorkspaceConnection environment={primary} />
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </>
            )}
            {!selection && primary && (
              <BotUsageLimitsButton
                key={primary.environmentId}
                environmentId={primary.environmentId}
                hostId={hostId ?? null}
                offline={!connected}
              />
            )}
            {deletedOpen && hostScope && (
              <BotDeletedChats
                {...hostScope}
                onClose={() => setDeletedOpen(false)}
                onOpen={(channelId, name) => {
                  setDeletedOpen(false);
                  navigation.navigate("BotGroupChat", { ...hostScope, channelId, name });
                }}
              />
            )}
            <BotCodeButton onPress={code} />
            <Menu
              actions={
                selection
                  ? [
                      { id: "threads", title: "Threads" },
                      ...(canOpenPins ? [{ id: "pins", title: "Pinned messages" }] : []),
                      ...toolNames.map((name) => ({ id: name, title: name })),
                      { id: "info", title: "Bot info" },
                      { id: "voice", title: "Voice settings" },
                      { id: "code", title: "Return to Code" },
                    ]
                  : [
                      ...(libraryAvailable ? [{ id: "library", title: "Library" }] : []),
                      ...(marketplaceAvailable
                        ? [{ id: "marketplace", title: "Marketplace" }]
                        : []),
                      ...(groupsAvailable ? [{ id: "deleted", title: "Deleted chats" }] : []),
                      ...(hostScope || offlineRoster
                        ? [{ id: "hidden", title: "Hidden chats" }]
                        : []),
                      { id: "settings", title: "Settings" },
                      { id: "voice", title: "Voice settings" },
                      { id: "code", title: "Return to Code" },
                    ]
              }
              onPressAction={({ nativeEvent }) => {
                const id = nativeEvent.event;
                if (id === "code") code();
                else if (id === "voice") navigation.navigate("SettingsBotVoice");
                else if (id === "settings") openServerSettings();
                else if (id === "library") openLibrary();
                else if (id === "marketplace") openMarketplace();
                else if (id === "deleted") setDeletedOpen(true);
                else if (id === "hidden") {
                  endSearch();
                  setHiddenOpen(true);
                } else if (id === "threads" && selection)
                  navigation.navigate("BotThreads", selection);
                else if (id === "pins" && selection && canOpenPins)
                  navigation.navigate("BotPinnedMessages", selection);
                else if (id === "info" && selection)
                  navigation.navigate("SettingsBotDetail", selection);
                else if (toolNames.includes(id as Tool)) setTool(id as Tool);
              }}
            >
              <BotGlass>
                <BotIconButton label={selection ? "Chat menu" : "Workspace menu"} icon="ellipsis" />
              </BotGlass>
            </Menu>
          </BotHeaderRow>
        )}
        {loading ? (
          <BotRosterLoading
            label={isReady ? "Connecting to your server" : "Loading your servers"}
          />
        ) : noServers ? (
          <EmptyBotRoster onOpen={() => onDrawerOpenChange(true)} />
        ) : selection ? (
          <SelectedBot
            key={JSON.stringify(selection)}
            selection={selection}
            tool={tool}
            onFiles={() => setTool("Files")}
          />
        ) : (
          <View ref={rosterViewport} collapsable={false} style={{ flex: 1 }}>
            <KeyboardAwareScrollView
              ref={rosterScroll}
              scrollEnabled={!rosterDragging}
              onLayout={(event) => {
                dragViewport.current.height = event.nativeEvent.layout.height;
              }}
              onContentSizeChange={(_width, height) => {
                dragViewport.current.content = height;
              }}
              onScroll={(event) => {
                dragViewport.current.offset = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              mode="insets"
              bottomOffset={GLASS_CAPSULE_HEIGHT + KEYBOARD_GAP}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                flexGrow: 1,
                paddingTop: searchOpen ? 24 : 0,
                paddingBottom: bottomSearchGap + GLASS_CAPSULE_HEIGHT + 24,
              }}
            >
              {!searchOpen && <BotWorkspaceUpdate />}
              {!searchOpen && (
                <Text
                  style={{
                    ...typeScale.largeTitle,
                    fontWeight: "700",
                    color: p.text,
                    paddingHorizontal: 20,
                    paddingTop: 16,
                    paddingBottom: 16,
                  }}
                >
                  {primary?.label ?? "Chats"}
                </Text>
              )}
              {searchIdle ? (
                <View style={{ paddingHorizontal: 16, gap: 12 }}>
                  <Text style={{ ...typeScale.caption, color: p.muted, paddingLeft: 4 }}>
                    Go to
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {shortcuts.map(({ title, icon, go }) => (
                      <Pressable
                        key={title}
                        accessibilityRole="button"
                        onPress={() => {
                          endSearch();
                          go();
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 7,
                          minHeight: 36,
                          backgroundColor: p.control,
                          borderRadius: 18,
                          paddingHorizontal: 13,
                          opacity: pressed ? 0.65 : 1,
                        })}
                      >
                        <SymbolView name={icon} size={17} tintColor={p.muted} />
                        <Text style={{ color: p.text, fontSize: 13 }}>{title}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : primary && (hostId || offlineRoster) ? (
                <BotChats
                  key={primary.environmentId}
                  environmentId={primary.environmentId}
                  hostId={hostId ?? offlineRoster!.hostId}
                  computerName={primary.label}
                  cacheScope={cacheScope}
                  offlineRoster={hostId ? null : offlineRoster}
                  search={search}
                  searching={searchOpen}
                  hiddenOpen={hiddenOpen}
                  dragging={rosterDragging}
                  scroll={rosterDragScroll}
                  onCloseHidden={closeHidden}
                  onSelect={choose}
                />
              ) : (
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingHorizontal: 24,
                    gap: 12,
                  }}
                >
                  <SymbolView
                    name={roster === "disabled" ? COMPUTERS_ICON : "wifi.slash"}
                    size={28}
                    tintColor={p.muted}
                  />
                  <Text
                    accessibilityRole="header"
                    style={{ color: p.text, fontSize: 17, fontWeight: "600", textAlign: "center" }}
                  >
                    {roster === "disabled"
                      ? "Bot hosting is off"
                      : roster === "failed"
                        ? "Bot hosting is unavailable"
                        : "Waiting for connection"}
                  </Text>
                  <Text style={{ color: p.muted, fontSize: 14, textAlign: "center" }}>
                    {roster === "disabled"
                      ? "Enable bot hosting on this computer to load its chats."
                      : roster === "failed"
                        ? (host.error ?? "Check the bot hosting settings for this computer.")
                        : "The agent list will load once this server is connected."}
                  </Text>
                  {roster !== "waiting" ||
                  (primary &&
                    primary.connection.phase !== "reconnecting" &&
                    primary.connection.phase !== "offline") ? (
                    <Pressable
                      accessibilityRole="button"
                      style={{
                        minHeight: 44,
                        justifyContent: "center",
                        paddingHorizontal: 16,
                        borderRadius: 22,
                        backgroundColor: p.control,
                      }}
                      onPress={() => {
                        if (roster === "waiting" && primary) {
                          if (paused)
                            void enableEnvironment({
                              environmentId: primary.environmentId,
                              enabled: true,
                            });
                          else void retryEnvironment(primary.environmentId);
                        } else openServerSettings();
                      }}
                    >
                      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>
                        {roster === "waiting"
                          ? paused
                            ? "Connect"
                            : "Try again"
                          : "Bot hosting settings"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </KeyboardAwareScrollView>
            <Animated.View
              pointerEvents="box-none"
              style={[
                {
                  position: "absolute",
                  bottom: bottomSearchGap,
                  left: insets.left + 16,
                  right: insets.right + 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                },
                searchBarStyle,
              ]}
            >
              {searchOpen && (
                <GlassCapsule
                  liquidGlass={liquidGlass}
                  fallbackBackground={p.surface}
                  width={GLASS_CAPSULE_HEIGHT}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close search"
                    onPress={endSearch}
                    style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                  >
                    <SymbolView name="chevron.down" size={19} tintColor={p.text} />
                  </Pressable>
                </GlassCapsule>
              )}
              <Animated.View
                layout={searchAnimation ? SEARCH_FIELD_LAYOUT : undefined}
                style={{ flex: 1 }}
              >
                <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={p.surface}>
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 15,
                    }}
                  >
                    <SymbolView name="magnifyingglass" size={19} tintColor={p.muted} />
                    <TextInput
                      accessibilityLabel="Search chats"
                      autoFocus={quickAction === "search"}
                      placeholder="Search"
                      placeholderTextColor={p.muted}
                      value={search}
                      onFocus={() => setSearchOpen(true)}
                      onChangeText={setSearch}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={{
                        flex: 1,
                        height: GLASS_CAPSULE_HEIGHT,
                        fontFamily,
                        fontSize: 16,
                        color: p.text,
                      }}
                    />
                  </View>
                </GlassCapsule>
              </Animated.View>
            </Animated.View>
          </View>
        )}
      </View>
    </BotComputerDrawer>
  );
}

function EmptyBotRoster({ onOpen }: { onOpen: () => void }) {
  const p = useBotPalette();
  return (
    <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
      <View
        className="size-16 items-center justify-center rounded-3xl"
        style={{ backgroundColor: p.control }}
      >
        <SymbolView name={COMPUTERS_ICON} size={28} tintColor={p.muted} />
      </View>
      <View className="items-center gap-1.5">
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 20, fontWeight: "700" }}>
          No servers available
        </Text>
        <Text style={{ color: p.muted, fontSize: 16, lineHeight: 26, textAlign: "center" }}>
          Connect the desktop app again or join a remote server.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        className="min-h-12 items-center justify-center rounded-xl px-4 active:opacity-60"
        style={{ backgroundColor: p.control }}
      >
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }}>Open servers</Text>
      </Pressable>
    </View>
  );
}

const decodeRosterReads = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Struct({ unreadCount: Schema.Int })),
);

function BotChats({
  environmentId,
  hostId,
  computerName,
  cacheScope,
  offlineRoster,
  search,
  searching,
  hiddenOpen,
  dragging,
  scroll,
  onCloseHidden,
  onSelect,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  computerName: string;
  cacheScope: string | null;
  offlineRoster: BotRosterCache | null;
  search: string;
  searching: boolean;
  hiddenOpen: boolean;
  dragging: boolean;
  scroll: RosterDragScroll;
  onCloseHidden: () => void;
  onSelect: (s: BotSelection) => void;
}) {
  const navigation = useNavigation();
  const p = useBotPalette();
  const organization = useBotRosterOrganization({
    environmentId,
    hostId,
    online: !offlineRoster,
    cacheScope,
  });
  const agents = useEnvironmentQuery(
    offlineRoster ? null : openbot.agents({ environmentId, input: {} }),
  );
  const groups = useEnvironmentQuery(
    offlineRoster
      ? null
      : openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "channel.list" } },
        }),
  );
  const readsQuery = useEnvironmentQuery(
    offlineRoster
      ? null
      : openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "workspace.reads" } },
        }),
  );
  const attentionQuery = useEnvironmentQuery(
    offlineRoster ? null : openbot.attention({ environmentId, input: {} }),
  );
  const reads = useMemo(() => decodeRosterReads(readsQuery.data), [readsQuery.data]);
  const waiting =
    attentionQuery.data?.hostId === hostId && attentionQuery.data.state === "ready"
      ? botRosterWaits(attentionQuery.data.requests)
      : null;
  const channels = useMemo(
    () => offlineRoster?.channels ?? channelList(groups.data) ?? [],
    [offlineRoster, groups.data],
  );
  const shownAgents = offlineRoster?.agents ?? agents.data;
  const hiddenAgents = JSON.stringify([...organization.hidden].sort());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronizes consented iOS launcher titles when the host's visible bots change.
  useLayoutEffect(() => {
    const hidden = new Set<string>(JSON.parse(hiddenAgents));
    const visible =
      agents.data && !agents.isPending && !offlineRoster
        ? new Map(
            agents.data
              .filter(({ id }) => !hidden.has(`agent:${id}`))
              .map(({ id, name }) => [id, name]),
          )
        : undefined;
    updateBotShortcutRoster({ environmentId, hostId, name: computerName }, visible);
  }, [
    agents.data,
    agents.isPending,
    computerName,
    environmentId,
    hiddenAgents,
    hostId,
    offlineRoster,
  ]);
  const live = useMemo(
    (): BotRosterCache | null =>
      agents.isSuccess && groups.isSuccess && agents.data && !agents.isPending && !groups.isPending
        ? { hostId, agents: agents.data.slice(0, 512), channels: channels.slice(0, 512) }
        : null,
    [
      agents.isSuccess,
      groups.isSuccess,
      agents.data,
      agents.isPending,
      groups.isPending,
      hostId,
      channels,
    ],
  );
  useBotCachedValue({
    scope: offlineRoster ? null : cacheScope,
    name: "roster",
    live,
    decode: decodeBotRosterCache,
  });
  const agentsById = useMemo(
    () => new Map(shownAgents?.map((agent) => [agent.id, agent])),
    [shownAgents],
  );
  const term = search.trim().toLocaleLowerCase();
  const rows = [
    ...(shownAgents ?? []).map((bot) => ({
      type: "bot" as const,
      bot,
      name: bot.name,
      updatedAt: bot.updatedAt,
    })),
    ...channels
      .filter((group) => !group.archived)
      .map((group) => ({
        type: "group" as const,
        group,
        name: group.name,
        updatedAt: group.lastMessage?.at ?? group.createdAt,
      })),
  ].sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0));
  const error = agents.error ?? groups.error ?? organization.error;
  const loading = agents.isPending || groups.isPending;
  const items: BotRosterPresentation[] = rows.map((row) => {
    const title = row.type === "bot" ? row.bot.title : row.group.title;
    const lastMessage = row.type === "group" ? row.group.lastMessage : null;
    const preview =
      row.type === "bot"
        ? row.bot.preview
        : lastMessage
          ? `${lastMessage.authorName}: ${lastMessage.text}`
          : null;
    const unread =
      row.type === "group"
        ? row.group.unreadCount
        : reads._tag === "Some"
          ? (reads.value[row.bot.id]?.unreadCount ?? 0)
          : 0;
    const id = row.type === "bot" ? row.bot.id : row.group.id;
    const wait = row.type === "bot" ? waiting?.get(id) : undefined;
    const status = botRosterStatusLabel(wait, unread);
    const date = row.updatedAt ? new Date(row.updatedAt) : null;
    const pin: BotRosterPin = { kind: row.type === "group" ? "channel" : "agent", id };
    const pinned = organization.pinned.some(
      (item) => botRosterItemKey(item) === botRosterItemKey(pin),
    );
    const sections = organization.layout?.sections ?? [];
    const open = () => {
      if (row.type === "group") {
        navigation.navigate("BotGroupChat", {
          environmentId,
          hostId,
          channelId: id,
          name: row.name,
        });
      } else {
        onSelect({
          environmentId,
          hostId,
          agentId: id,
          name: row.name,
          avatarSeed: row.bot.avatarSeed,
          avatarHue: row.bot.avatarHue,
        });
      }
    };
    const avatar = (size: number) =>
      row.type === "group" ? (
        <GroupAvatar members={row.group.members} agents={agentsById} size={size} />
      ) : (
        <BotAvatar seed={row.bot.avatarSeed ?? id} hue={row.bot.avatarHue} size={size} />
      );
    return {
      pin,
      name: row.name,
      unread,
      updatedAt: row.updatedAt,
      needsInput: wait !== undefined,
      open,
      avatar,
      row: (
        <BotChatRow
          key={`${row.type}:${id}`}
          actions={[
            ...(offlineRoster
              ? []
              : [{ id: "info", title: row.type === "group" ? "Group info" : "Bot info" }]),
            ...(organization.canPin
              ? [{ id: "pin", title: pinned ? "Unpin chat" : "Pin chat" }]
              : []),
            ...(organization.canHide(pin) ? [{ id: "hide", title: "Hide chat" }] : []),
            ...(organization.canEditSections && sections.length
              ? [
                  {
                    id: "move-section",
                    title: "Move to section",
                    subactions: [
                      { id: "section-main", title: "Main list" },
                      ...sections.map((section) => ({
                        id: `section:${section.id}`,
                        title: section.name,
                      })),
                    ],
                  },
                ]
              : []),
            { id: "copy", title: "Copy ID" },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "copy") {
              void Clipboard.setStringAsync(id);
              return;
            }
            if (nativeEvent.event === "pin") {
              void organization.pin(pin);
              return;
            }
            if (nativeEvent.event === "hide") {
              if (pin.kind === "channel" || !organization.hostOwnsHide) {
                void organization.setHidden(pin, true);
              } else
                Dialog.confirm({
                  title: "Hide this bot?",
                  message: organization.hiddenAgentsStillWork
                    ? "This bot will be hidden for everyone on this computer. It can still work."
                    : "A hidden bot cannot receive new messages or run routines until you show it again.",
                  confirmText: "Hide chat",
                  onConfirm: () => void organization.setHidden(pin, true),
                });
              return;
            }
            if (nativeEvent.event === "section-main" || nativeEvent.event.startsWith("section:")) {
              const section = sections.find((item) => nativeEvent.event === `section:${item.id}`);
              if (section || nativeEvent.event === "section-main") {
                void organization.editSection({
                  type: "assign",
                  agentId: id,
                  sectionId: section?.id ?? null,
                });
              }
              return;
            }
            if (nativeEvent.event !== "info") return;
            if (row.type === "group") {
              navigation.navigate("BotGroups", { environmentId, hostId, channelId: id });
            } else {
              navigation.navigate("SettingsBotDetail", {
                environmentId,
                hostId,
                agentId: id,
                name: row.name,
              });
            }
          }}
          accessibilityLabel={[row.name, row.type === "group" ? "group chat" : "", status]
            .filter(Boolean)
            .join(", ")}
          disabled={!hostId}
          onChoose={open}
        >
          <View>
            {avatar(54)}
            <BotRosterAvatarBadge wait={wait} unread={unread} avatarSize={54} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  fontSize: 16,
                  lineHeight: 21,
                  fontWeight: "600",
                  color: p.text,
                }}
              >
                {row.name}
              </Text>
              {wait ? (
                <BotRosterWaitChip wait={wait} />
              ) : date && Number.isFinite(date.getTime()) ? (
                <Text style={{ ...typeScale.caption, color: p.muted }}>
                  {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
              ) : null}
            </View>
            {!!title && (
              <Text numberOfLines={1} style={{ ...typeScale.caption, color: p.muted }}>
                {title}
              </Text>
            )}
            {!!preview && (
              <Text numberOfLines={1} style={{ ...typeScale.preview, color: p.muted }}>
                {preview}
              </Text>
            )}
          </View>
        </BotChatRow>
      ),
    };
  });
  const matching = items.filter((item) => item.name.toLocaleLowerCase().includes(term));
  const unreadChats = items
    .filter(({ pin, unread }) => unread > 0 && organization.canMarkRead(pin))
    .map(({ pin }) => pin);
  const hasVisibleChats = matching.some(
    ({ pin }) => !organization.hidden.has(botRosterItemKey(pin)),
  );
  return (
    <View>
      {!searching && (
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 13, color: p.muted }}>
            {offlineRoster ? "Offline chats" : "Chats"}
          </Text>
          {!offlineRoster && (
            <Menu
              actions={[
                { id: "bot", title: "New bot" },
                { id: "new-group", title: "New group chat" },
                { id: "groups", title: "Manage group chats" },
                ...(organization.canSaveOrder
                  ? [
                      {
                        id: "sort",
                        title: "Sort chats",
                        subactions: BOT_ROSTER_ORDERS.map((order) => ({
                          id: `sort:${order}`,
                          title: BOT_ROSTER_ORDER_LABELS[order],
                          state: order === organization.order ? ("on" as const) : ("off" as const),
                        })),
                      },
                    ]
                  : []),
                ...(organization.canEditSections
                  ? [{ id: "new-section", title: "New section" }]
                  : []),
                {
                  id: "mark-all-read",
                  title: "Mark all as read",
                  attributes: { disabled: organization.busy || unreadChats.length === 0 },
                },
              ]}
              onPressAction={({ nativeEvent }) => {
                const order = BOT_ROSTER_ORDERS.find(
                  (candidate) => nativeEvent.event === `sort:${candidate}`,
                );
                if (order) void organization.setOrder(order);
                if (nativeEvent.event === "mark-all-read")
                  void organization.markAllRead(unreadChats);
                if (nativeEvent.event === "new-section") requestBotRosterSection(organization);
                if (nativeEvent.event === "bot")
                  navigation.navigate("SettingsBotNew", { environmentId, hostId });
                if (nativeEvent.event === "new-group")
                  navigation.navigate("BotGroups", { environmentId, hostId, create: true });
                if (nativeEvent.event === "groups")
                  navigation.navigate("BotGroups", { environmentId, hostId });
              }}
            >
              <BotIconButton label="New chat or manage groups" icon="square.and.pencil" />
            </Menu>
          )}
        </View>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ paddingHorizontal: 20, paddingVertical: 8, color: p.muted }}
        >
          {error}
        </Text>
      )}
      {!hasVisibleChats && !error && (
        <Text style={{ padding: 20, color: p.muted }}>
          {loading
            ? "Loading chats…"
            : !hostId
              ? "This environment is offline."
              : term
                ? "No matching chats."
                : "No chats yet."}
        </Text>
      )}
      <BotRosterGroups
        items={matching}
        organization={organization}
        filtered={searching}
        dragging={dragging}
        scroll={scroll}
      />
      {hiddenOpen && (
        <BotHiddenChats items={items} organization={organization} onClose={onCloseHidden} />
      )}
    </View>
  );
}

/** Reject motion within the wide row as well as motion outside it. */
function BotChatRow({
  children,
  accessibilityLabel,
  disabled,
  onChoose,
  actions,
  onPressAction,
}: {
  children: ReactNode;
  actions: ComponentProps<typeof Menu>["actions"];
  onPressAction: ComponentProps<typeof Menu>["onPressAction"];
  accessibilityLabel: string;
  disabled: boolean;
  onChoose: () => void;
}) {
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <Menu shouldOpenOnLongPress actions={actions} onPressAction={onPressAction}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onTouchStart={({ nativeEvent }) => {
          touch.current = { x: nativeEvent.pageX, y: nativeEvent.pageY, moved: false };
        }}
        onTouchMove={({ nativeEvent }) => {
          const start = touch.current;
          if (start && Math.hypot(nativeEvent.pageX - start.x, nativeEvent.pageY - start.y) > 12)
            start.moved = true;
        }}
        onPress={({ nativeEvent }) => {
          const start = touch.current;
          touch.current = null;
          if (
            typeof nativeEvent.identifier === "number" &&
            start &&
            (start.moved ||
              Math.hypot(nativeEvent.pageX - start.x, nativeEvent.pageY - start.y) > 12)
          )
            return;
          onChoose();
        }}
        style={({ pressed }) => ({
          minHeight: 80,
          paddingHorizontal: 20,
          paddingVertical: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed ? 0.58 : 1,
        })}
      >
        {children}
      </Pressable>
    </Menu>
  );
}

function SelectedBot({
  selection,
  tool,
  onFiles,
}: {
  selection: BotSelection;
  tool: Tool;
  onFiles: () => void;
}) {
  const { environmentId, hostId, agentId } = selection;
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { swipeAction } = useBotChatAppearance();
  const openSwipeAction = () => {
    Keyboard.dismiss();
    if (swipeAction === "threads") navigation.navigate("BotThreads", selection);
    if (swipeAction === "browser")
      navigation.navigate("BotBrowser", { environmentId, hostId, agentId });
  };
  const swipeForward = usePanGesture({
    enabled: focused && tool === "Chat" && swipeAction !== "off",
    activeOffsetX: -28,
    failOffsetX: 8,
    failOffsetY: [-18, 18],
    maxPointers: 1,
    onDeactivate: (event) => {
      "worklet";
      if (
        !event.canceled &&
        isCommittedRightSwipe(-event.translationX, event.translationY, -event.velocityX)
      )
        scheduleOnRN(openSwipeAction);
    },
  });
  const p = useBotPalette();
  const online = useBotEnvironmentOnline(environmentId);
  const host = useEnvironmentQuery(online ? openbot.status({ environmentId, input: {} }) : null);
  if (tool === "Chat" && host.data?.state !== "ready")
    return (
      <BotOfflineHistory
        environmentId={environmentId}
        hostId={hostId}
        chat={{ kind: "agent", id: agentId }}
        connecting={host.isPending}
      />
    );
  if (host.data?.state !== "ready" || host.data.hostId !== hostId)
    return (
      <Text accessibilityRole="alert" style={{ padding: 20, color: p.muted }}>
        {host.error ?? "Reconnect to this bot’s environment to continue."}
      </Text>
    );
  return (
    <View style={{ flex: 1 }}>
      <View style={tool === "Chat" ? { flex: 1 } : { display: "none" }}>
        <GestureDetector gesture={swipeForward}>
          <View style={{ flex: 1 }}>
            <BotNativeConversation
              environmentId={environmentId}
              hostId={hostId}
              agentId={agentId}
              name={selection.name}
              forwardGesture={swipeForward}
              avatarSeed={selection.avatarSeed}
              avatarHue={selection.avatarHue}
              visible={tool === "Chat"}
              onFiles={onFiles}
              workspace
            />
          </View>
        </GestureDetector>
      </View>
      {tool !== "Chat" && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 16, padding: 20 }}
        >
          {tool === "Files" && (
            <BotFiles environmentId={environmentId} hostId={hostId} agentId={agentId} />
          )}
          {tool === "Browser" && (
            <BotBrowser environmentId={environmentId} hostId={hostId} agentId={agentId} />
          )}
          {tool === "Computer" && (
            <ComputerEnvironment environmentId={environmentId} hostId={hostId} />
          )}
          {tool === "Vault" && <BotVault environmentId={environmentId} hostId={hostId} />}
          {tool === "Data" && <DataEnvironment environmentId={environmentId} hostId={hostId} />}
          {tool === "Attention" && <BotAttention environmentId={environmentId} agentId={agentId} />}
          {tool === "Channels" && (
            <>
              <BotChannels environmentId={environmentId} hostId={hostId} />
              <BotChannelExtras environmentId={environmentId} hostId={hostId} />
            </>
          )}
          {tool === "Workflows" && (
            <>
              <BotEvents environmentId={environmentId} hostId={hostId} />
              <BotRoutineFlows environmentId={environmentId} hostId={hostId} />
              <BotWorkflows environmentId={environmentId} hostId={hostId} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
