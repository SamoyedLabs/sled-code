import { useBotReducedMotion } from "./botFeedback";
import { OpenBotTypography } from "./upstream/OpenBotTypography";
import { BotVaultEntry } from "../settings/BotVault";
import { BotServerStorage } from "../settings/BotServerStorage";
import {
  BotHostAgentDefaults,
  BotBackgroundProcesses,
  BotHostLearning,
} from "../settings/BotHostAgentDefaults";
import { BotHostTimezone } from "../settings/BotHostTimezone";
import { BotInstanceTransfer } from "../settings/BotInstanceTransfer";
import { BotImportEnvironment } from "../settings/BotImportEnvironment";
import { BotRoutineNotification } from "./BotRoutineNotification";
import { BotSettingsEnvironment } from "../settings/BotSettingsEnvironment";
import { DataEnvironment } from "../settings/DataEnvironment";
import { BotEvents } from "./BotEvents";
import { BotRoutineFlows } from "./BotRoutineFlows";
import { BotConversationPanel } from "../settings/BotConversationPanel";
import { botHostRecoveryDescription } from "@t3tools/client-runtime/openbot/presentation";
import { BotProviderChoice } from "../settings/BotProviderChoice";
import { BotRuntimeControls } from "../settings/BotRuntimeControls";
import { OpenbotMaintenance } from "../settings/OpenbotMaintenance";
import { BotFiles } from "../settings/BotFiles";
import { ComputerEnvironment } from "../settings/ComputerEnvironment";
import { BotBrowser } from "../settings/BotBrowser";
import { BotCodingPolicy } from "../settings/BotCodingPolicy";
import { BotWorkflows } from "../settings/BotWorkflows";
import { BotChannels } from "../settings/BotChannels";
import { BotChannelExtras } from "../settings/BotChannelExtras";
import { BotProviderSetup } from "../settings/BotProviderSetup";
import { BotProviderSettings } from "../settings/BotProviderSettings";
import { BotAttention } from "../settings/BotAttention";
import { SledToolsConnection } from "../settings/SledToolsConnection";
import { BotConfiguration } from "../settings/BotConfiguration";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useLayoutEffect, useRef, useState } from "react";
import { Keyboard, Platform, View, useWindowDimensions } from "react-native";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { requireOptionalNativeModule } from "expo";
import { isCommittedRightSwipe } from "./bots-edge-gesture";
import { useReturnToCode } from "./useReturnToCode";
import { scheduleOnRN } from "react-native-worklets";
import { BotNativeWorkspace, type BotSelection } from "./BotNativeWorkspace";
import * as Crypto from "expo-crypto";
import type { EnvironmentId, OpenbotAdminRequest, OpenbotWriteRequest } from "@t3tools/contracts";
import {
  botViewRequest,
  providerModels,
  providerStatus,
  validProviderChoice,
  botCreateRequest,
  EMPTY_BOT_PROVIDER_CHOICE,
  type BotProviderChoice as ProviderChoice,
  memoryViews,
  routineViews,
  taskViews,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { openbot } from "../../state/openbot";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentMenu } from "../settings/components/SettingsEnvironmentFilterHeader";
import {
  useSettingsEnvironmentFilter,
  type SettingsTarget,
} from "../settings/settings-environment-filter";
import { m } from "../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react-native";

const botServerSettings = {
  general: {
    label: m(msg("General")),
    icon: "gearshape",
    description: m(msg("Hosting and connections")),
  },
  ai: { label: "AI", icon: "robot", description: m(msg("Providers and Sled tools")) },
  data: {
    label: m(msg("Data")),
    icon: "internaldrive",
    description: m(msg("Import and transfer agents")),
  },
  maintenance: {
    label: m(msg("Maintenance")),
    icon: "hammer",
    description: m(msg("Engine releases and updates")),
  },
} as const;

type BotSettingsCategory = keyof typeof botServerSettings;

export function SettingsBotsRouteScreen({
  route,
}: StaticScreenProps<
  { environmentId: EnvironmentId; category?: BotSettingsCategory } | undefined
>) {
  if (!route.params) return <BotsRouteScreen />;
  return (
    <OpenBotTypography>
      <BotsRouteScreen
        environmentId={route.params.environmentId}
        category={route.params.category}
      />
    </OpenBotTypography>
  );
}

function LeftBotsPage({
  openRoster,
  openingVelocity,
  quickAction,
  showHiddenChats,
  initialSelection,
}: {
  openRoster: boolean;
  openingVelocity: number;
  quickAction?: "search";
  showHiddenChats?: boolean;
  initialSelection?: BotSelection;
}) {
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const returnToCode = useReturnToCode();
  const reduceMotion = useBotReducedMotion();
  const position = useSharedValue(reduceMotion ? 0 : -1);
  const started = useRef(false);
  const leaving = useRef(false);
  const closing = useSharedValue(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [directChatOpen, setDirectChatOpen] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hide the native Expo Tools overlay while it would cover the Bots menu.
  useLayoutEffect(() => {
    if (!__DEV__) return;
    const devMenu = requireOptionalNativeModule<{ setToolsButtonVisible(visible: boolean): void }>(
      "ExpoDevMenu",
    );
    devMenu?.setToolsButtonVisible(false);
    return () => devMenu?.setToolsButtonVisible(true);
  }, []);
  const dragStart = useSharedValue(0);
  const close = (velocity = 0) => {
    if (leaving.current) return;
    leaving.current = true;
    closing.set(true);
    Keyboard.dismiss();
    if (reduceMotion) {
      returnToCode();
      return;
    }
    position.set(
      withSpring(
        -1,
        {
          duration: 300,
          dampingRatio: 1,
          overshootClamping: true,
          velocity: Math.max(-3, Math.min(0, velocity / width)),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) scheduleOnRN(returnToCode);
        },
      ),
    );
  };
  const gesture = usePanGesture({
    enabled: focused && !drawerOpen && !directChatOpen,
    activeOffsetX: -16,
    failOffsetX: 8,
    failOffsetY: [-20, 20],
    maxPointers: 1,
    onActivate: () => {
      "worklet";
      if (closing.get()) return;
      cancelAnimation(position);
      dragStart.set(position.get());
    },
    onUpdate: (event) => {
      "worklet";
      if (!reduceMotion && !closing.get())
        position.set(Math.min(0, Math.max(-1, dragStart.get() + event.translationX / width)));
    },
    onDeactivate: (event) => {
      "worklet";
      if (closing.get()) return;
      if (
        !event.canceled &&
        isCommittedRightSwipe(-event.translationX, event.translationY, -event.velocityX)
      ) {
        scheduleOnRN(close, event.velocityX);
      } else {
        position.set(
          withSpring(0, {
            duration: 300,
            dampingRatio: 1,
            overshootClamping: true,
            reduceMotion: ReduceMotion.System,
          }),
        );
      }
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: width * position.get() }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityViewIsModal
        onLayout={() => {
          if (started.current) return;
          started.current = true;
          // Start after the native modal has laid out. Fabric can mount its stack
          // while the presentation is still offscreen.
          requestAnimationFrame(() => {
            if (leaving.current) return;
            position.set(
              withSpring(0, {
                duration: 300,
                dampingRatio: 1,
                overshootClamping: true,
                velocity: Math.max(0, Math.min(3, openingVelocity / width)),
                reduceMotion: ReduceMotion.System,
              }),
            );
          });
        }}
        style={[{ flex: 1 }, style]}
      >
        <BotNativeWorkspace
          openRoster={openRoster}
          initialSelection={initialSelection}
          onReturnToCode={() => close()}
          drawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
          onDirectChatOpenChange={setDirectChatOpen}
          quickAction={quickAction}
          showHiddenChats={showHiddenChats === true}
        />
      </Animated.View>
    </GestureDetector>
  );
}

export function BotChatWorkspace({ selection }: { selection: BotSelection }) {
  return (
    <OpenBotTypography>
      <LeftBotsPage openRoster={false} openingVelocity={0} initialSelection={selection} />
    </OpenBotTypography>
  );
}

export function BotWorkspaceRouteScreen({
  route,
}: StaticScreenProps<
  | {
      openRoster?: boolean;
      openingVelocity?: number;
      quickAction?: "search";
      showHiddenChats?: boolean;
    }
  | undefined
>) {
  if (Platform.OS !== "ios") return <BotsRouteScreen workspace />;
  const candidate = route.params?.quickAction;
  const quickAction = candidate === "search" ? candidate : undefined;
  return (
    <OpenBotTypography>
      <LeftBotsPage
        openRoster={route.params?.openRoster === true || quickAction !== undefined}
        openingVelocity={route.params?.openingVelocity ?? 0}
        quickAction={quickAction}
        showHiddenChats={route.params?.showHiddenChats === true}
      />
    </OpenBotTypography>
  );
}

function BotsRouteScreen({
  workspace = false,
  environmentId,
  category,
}: {
  workspace?: boolean;
  environmentId?: EnvironmentId | undefined;
  category?: BotSettingsCategory | undefined;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets, availableTargets } = useSettingsEnvironmentFilter();
  const targets =
    environmentId === undefined
      ? selectedTargets
      : availableTargets.filter((target) => target.environmentId === environmentId);
  const categoryLabel =
    category && Object.hasOwn(botServerSettings, category)
      ? botServerSettings[category].label
      : undefined;
  const scopedHome = environmentId !== undefined && categoryLabel === undefined;
  return (
    <SettingsScreen
      title={categoryLabel ?? (environmentId ? gt("Server settings") : gt("Bots"))}
      menus={environmentId ? undefined : [environmentMenu]}
    >
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 py-4"
      >
        {environmentId === undefined && (
          <>
            <Text className="text-foreground-muted">
              <T>Persistent teammates for ongoing responsibilities, tasks, and coding work.</T>
            </Text>
            <Button
              label={workspace ? gt("Bot hosting and providers") : gt("Open bot workspace")}
              tone="secondary"
              onPress={() => navigation.navigate(workspace ? "SettingsBots" : "Bots")}
            />
          </>
        )}
        {scopedHome && targets.length > 0 && (
          <SettingsSection title={targets[0]?.label}>
            {(Object.keys(botServerSettings) as BotSettingsCategory[]).map((key) => {
              const item = botServerSettings[key];
              return (
                <SettingsRow
                  key={key}
                  icon={item.icon}
                  label={item.label}
                  value={item.description}
                  valuePosition="below"
                  onPress={() =>
                    navigation.dispatch(
                      StackActions.push("SettingsBots", { environmentId, category: key }),
                    )
                  }
                />
              );
            })}
          </SettingsSection>
        )}
        {!scopedHome &&
          targets.map((environment) => (
            <BotEnvironment
              key={environment.environmentId}
              environment={environment}
              workspace={workspace}
              category={category}
            />
          ))}
        {targets.length === 0 && (
          <Text>
            {environmentId
              ? gt("Reconnect this computer to manage its bots.")
              : availableTargets.length === 0
                ? gt("Connect an environment to manage its bots.")
                : gt("No environments match these filters.")}
          </Text>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function BotEnvironment({
  environment,
  workspace = false,
  category,
}: {
  environment: SettingsTarget;
  workspace?: boolean;
  category?: BotSettingsCategory | undefined;
}) {
  const gt = useGT();
  const [view, setView] = useState("bots");
  const environmentId = environment.environmentId;
  const navigation = useNavigation();
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(
    host.data?.state === "ready" ? openbot.agents({ environmentId, input: {} }) : null,
  );
  const canManage = useAtomValue(openbot.start.permissionAtom(environmentId));
  const canCreate = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId: host.data?.hostId ?? "unavailable",
      request: {
        operation: "agent.create",
        input: {
          name: "permission check",
          description: "",
          initialMessage: gt("permission check"),
        },
      },
    }),
  );
  const start = useAtomCommand(openbot.start, { reportFailure: false });
  const stop = useAtomCommand(openbot.stop, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const [engineBusy, setEngineBusy] = useState<"start" | "stop" | null>(null);
  const engineEpoch = useRef(0);
  const act = async (operation: "start" | "stop") => {
    if (engineBusy === "stop" || (operation === "start" && engineBusy !== null)) return;
    const epoch = ++engineEpoch.current;
    setEngineBusy(operation);
    setError(null);
    const result = await (operation === "start" ? start : stop)({ environmentId, input: {} });
    if (engineEpoch.current === epoch) {
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      setEngineBusy(null);
    }
    host.refresh();
    agents.refresh();
  };
  const state = host.data?.state;
  const showHosting = category === undefined || category === "general";
  return (
    <SettingsSection title={environment.label}>
      <View className="gap-3 p-4">
        {showHosting && (
          <>
            {!workspace && (
              <Text className="text-foreground-muted">
                <T>
                  This iPhone controls bot hosting on <Var>{environment.label}</Var>. Bots run on
                  that computer, not on your iPhone. Hosting is optional for each computer and is
                  separate from persistent remote-desktop streaming.
                </T>
              </Text>
            )}
            <Text accessibilityLiveRegion="polite">
              {host.isPending
                ? gt("Checking bot hosting…")
                : state === "ready"
                  ? gt("Bot hosting is running")
                  : state === "disabled"
                    ? gt("Bot hosting is not configured on this computer")
                    : state === "starting"
                      ? gt("Enabling bot hosting…")
                      : state === "failed"
                        ? gt("Bot hosting failed: {value}", {
                            value: host.data?.reason ?? "unknown",
                          })
                        : gt("Bot hosting is off")}
            </Text>
            {(error || host.error || agents.error) && (
              <Text accessibilityRole="alert" className="text-danger">
                {error ?? host.error ?? agents.error}
              </Text>
            )}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={gt("Refresh")}
                size="compact"
                disabled={engineBusy !== null}
                onPress={() => {
                  host.refresh();
                  agents.refresh();
                }}
              />
              {!workspace && state && state !== "disabled" && (
                <Button
                  label={
                    engineBusy === "start"
                      ? gt("Enabling…")
                      : host.data?.desiredRunning && state !== "ready"
                        ? gt("Retry bot hosting")
                        : gt("Enable bot hosting")
                  }
                  size="compact"
                  disabled={
                    !canManage ||
                    engineBusy !== null ||
                    state === "starting" ||
                    host.data?.recovery?.state === "switching" ||
                    (state === "ready" && host.data?.desiredRunning !== false)
                  }
                  onPress={() => void act("start")}
                />
              )}
              {!workspace && state && (state !== "disabled" || host.data?.desiredRunning) && (
                <Button
                  label={engineBusy === "stop" ? gt("Disabling…") : gt("Disable bot hosting")}
                  size="compact"
                  disabled={!canManage || engineBusy === "stop"}
                  onPress={() => void act("stop")}
                />
              )}
            </View>
            {host.data && (
              <Text textRole="footnote" className="text-foreground-muted">
                {botHostRecoveryDescription(host.data)}
              </Text>
            )}
            {!canManage && state !== "disabled" && (
              <Text textRole="footnote" className="text-foreground-muted">
                <T>
                  Settings permission is required to enable or disable bot hosting on<Var> </Var>
                  <Var>{environment.label}</Var>.
                </T>
              </Text>
            )}
            {!workspace && (
              <>
                <Button
                  label={gt("Connect to another computer")}
                  tone="secondary"
                  onPress={() => navigation.navigate("Connections")}
                />
              </>
            )}
          </>
        )}
        {!workspace && showHosting && state === "ready" && host.data?.hostId && (
          <BotHostTimezone
            key={host.data.hostId}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {!workspace && (category === undefined || category === "maintenance") && (
          <>
            <BotRuntimeControls environmentId={environmentId} />
            <OpenbotMaintenance environmentId={environmentId} />
          </>
        )}
        {!workspace &&
          (category === undefined || category === "data") &&
          state === "ready" &&
          host.data?.hostId && (
            <View key={`${environmentId}:${host.data.hostId}`} className="gap-4">
              <BotServerStorage
                environmentId={environmentId}
                hostId={host.data.hostId}
                name={environment.label}
              />
              <BotBackgroundProcesses environmentId={environmentId} hostId={host.data.hostId} />
              <BotInstanceTransfer environmentId={environmentId} hostId={host.data.hostId} />
              <BotVaultEntry environmentId={environmentId} hostId={host.data.hostId} />
              <BotImportEnvironment
                environmentId={environmentId}
                hostId={host.data.hostId}
                destination={environment.label}
              />
            </View>
          )}
        {!workspace && (category === undefined || category === "ai") && state === "ready" && (
          <SledToolsConnection environmentId={environmentId} />
        )}
        {(category === "ai" || category === "data") && state !== "ready" && (
          <Text accessibilityRole={host.error ? "alert" : "status"}>
            {host.error ??
              (host.isPending
                ? gt("Checking bot hosting…")
                : gt("Enable bot hosting in General to continue."))}
          </Text>
        )}
        {workspace && (
          <View className="flex-row flex-wrap gap-2">
            {["bots", "approvals", "channels", "workflows"].map((value) => (
              <Button
                key={value}
                size="compact"
                tone={view === value ? "primary" : "secondary"}
                label={
                  value === "bots"
                    ? gt("Bots")
                    : value === "approvals"
                      ? gt("Needs attention")
                      : value === "channels"
                        ? gt("Channels")
                        : gt("Workflows")
                }
                onPress={() => setView(value)}
              />
            ))}
          </View>
        )}
        {workspace && view === "approvals" && state === "ready" && (
          <BotAttention environmentId={environmentId} />
        )}
        {workspace && view === "workflows" && state === "ready" && host.data?.hostId && (
          <>
            <BotEvents
              key={`events:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
            <BotRoutineFlows
              key={`flows:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
          </>
        )}
        {workspace && view === "workflows" && state === "ready" && host.data?.hostId && (
          <BotWorkflows
            key={`workflows:${host.data.hostId}`}
            environmentId={environmentId}
            hostId={host.data.hostId}
          />
        )}
        {workspace && view === "channels" && state === "ready" && host.data?.hostId && (
          <>
            <BotChannels
              key={`channels:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
            <BotChannelExtras
              key={`channel-extras:${host.data.hostId}`}
              environmentId={environmentId}
              hostId={host.data.hostId}
            />
          </>
        )}
        {!workspace &&
          (category === undefined || category === "ai") &&
          state === "ready" &&
          host.data?.hostId && (
            <>
              <BotHostAgentDefaults environmentId={environmentId} hostId={host.data.hostId} />
              <BotHostLearning environmentId={environmentId} hostId={host.data.hostId} />
              <Button
                label={gt("Provider setup")}
                tone="secondary"
                onPress={() => {
                  if (host.data?.hostId)
                    navigation.navigate("SettingsBotProviders", {
                      environmentId,
                      hostId: host.data.hostId,
                    });
                }}
              />
            </>
          )}
        {workspace && view === "bots" && state === "ready" && (
          <>
            <Button
              label={gt("Create bot")}
              icon="plus"
              size="compact"
              disabled={!canCreate || !host.data?.hostId}
              onPress={() => {
                if (host.data?.hostId)
                  navigation.navigate("SettingsBotNew", {
                    environmentId,
                    hostId: host.data.hostId,
                  });
              }}
            />
            {agents.isPending && !agents.data && (
              <Text>
                <T>Loading bots…</T>
              </Text>
            )}
            {agents.data?.length === 0 && (
              <Text className="text-foreground-muted">
                <T>No bots yet. Create one and give it a responsibility.</T>
              </Text>
            )}
            {agents.data?.map((bot) => (
              <ListRow
                key={bot.id}
                label={bot.name}
                description={bot.provider}
                onPress={() =>
                  navigation.navigate("SettingsBotDetail", {
                    environmentId,
                    agentId: bot.id,
                    name: bot.name,
                    hostId: host.data?.hostId,
                  })
                }
              />
            ))}
          </>
        )}
      </View>
    </SettingsSection>
  );
}

export function SettingsBotNewRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: EnvironmentId; hostId: string }>) {
  const gt = useGT();
  const environmentId = route.params.environmentId;
  const expectedHostId = route.params.hostId;
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const modelsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId: expectedHostId, request: { operation: "agent.models" } },
    }),
  );
  const statusQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId: expectedHostId, request: { operation: "agent.status" } },
    }),
  );
  const models = providerModels(modelsQuery.data);
  const providers = providerStatus(statusQuery.data);
  const [choice, setChoice] = useState<ProviderChoice>(EMPTY_BOT_PROVIDER_CHOICE);
  const navigation = useNavigation();
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId: expectedHostId,
      request: {
        operation: "agent.create",
        input: {
          name: "permission check",
          description: "",
          initialMessage: gt("permission check"),
        },
      },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (
      busy ||
      host.data?.hostId !== expectedHostId ||
      !models ||
      !providers ||
      !validProviderChoice(models, providers, choice)
    )
      return;
    const request = botCreateRequest(name, instructions, choice);
    if (!request) return;
    setBusy(true);
    setError(null);
    const result = await admin({ environmentId, input: { hostId: expectedHostId, request } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else navigation.goBack();
    setBusy(false);
  };
  return (
    <SettingsScreen title={gt("Create bot")}>
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        <Text>
          <T>Name</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Bot name")}
          defaultValue=""
          onChangeText={setName}
          maxLength={80}
          className="min-h-12 rounded-xl bg-grouped-card p-3"
        />
        <Text>
          <T>Responsibility and instructions</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Responsibility and instructions")}
          defaultValue=""
          onChangeText={setInstructions}
          maxLength={2000}
          multiline
          textAlignVertical="top"
          className="min-h-32 rounded-xl bg-grouped-card p-3"
        />
        <BotProviderChoice
          value={choice}
          onChange={setChoice}
          models={models ?? []}
          providers={providers ?? []}
          disabled={busy || !canAdmin || models === null || providers === null}
        />
        <Text className="text-foreground-muted">
          <T>
            Creating a bot sends its first message using the selected model and the provider's own
            sign-in. Other accounts can be assigned after creation.
          </T>
        </Text>
        <Button
          label={gt("Provider setup")}
          tone="secondary"
          onPress={() =>
            navigation.navigate("SettingsBotProviders", { environmentId, hostId: expectedHostId })
          }
        />
        <Button
          label={gt("Refresh providers")}
          tone="text"
          onPress={() => {
            modelsQuery.refresh();
            statusQuery.refresh();
          }}
        />
        {(modelsQuery.error || statusQuery.error || host.data?.hostId !== expectedHostId) && (
          <Text accessibilityRole="alert" className="text-danger">
            {modelsQuery.error ??
              statusQuery.error ??
              gt("The bot engine changed. Reopen this form before creating a bot.")}
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        )}
        <Button
          label={gt("Create bot")}
          loading={busy}
          disabled={
            !canAdmin ||
            !name.trim() ||
            !instructions.trim() ||
            !models ||
            !providers ||
            !validProviderChoice(models, providers, choice) ||
            host.data?.hostId !== expectedHostId
          }
          onPress={() => void create()}
        />
      </ScreenScrollView>
    </SettingsScreen>
  );
}

type BotTab = "conversation" | "task" | "memory" | "routine";
export function SettingsBotDetailRouteScreen({
  route,
}: StaticScreenProps<{
  environmentId: EnvironmentId;
  agentId: string;
  name: string;
  hostId?: string;
}>) {
  return (
    <BotDetail key={`${route.params.environmentId}:${route.params.agentId}`} {...route.params} />
  );
}
export function BotDetail({
  environmentId,
  agentId,
  name,
  hostId,
  initialTaskId,
  initialRoutineId,
  initialRoutineRunId,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  name: string;
  hostId?: string;
  initialTaskId?: string;
  initialRoutineId?: string;
  initialRoutineRunId?: string;
}) {
  const gt = useGT();
  const pendingMessage = useRef<{ text: string; id: string } | null>(null);
  const messageIdFor = (value: string) => {
    if (pendingMessage.current?.text !== value)
      pendingMessage.current = { text: value, id: Crypto.randomUUID() };
    return pendingMessage.current.id;
  };
  const navigation = useNavigation();
  const [selectedTask, setSelectedTask] = useState<string | null>(initialTaskId ?? null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [tab, setTab] = useState<BotTab>(
    initialTaskId ? "task" : initialRoutineId ? "routine" : "conversation",
  );
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [text, setText] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    tab === "conversation" || (tab === "task" && selectedTask !== null)
      ? null
      : openbot.read({ environmentId, input: botViewRequest(agentId, tab, selectedTask) }),
  );
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const coding = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.codingTasks({ environmentId, input: { hostId: host.data.hostId, agentId } })
      : null,
  );
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId)) && Boolean(hostId);
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const send = async (input: OpenbotWriteRequest | OpenbotAdminRequest, privileged = false) => {
    if (busy || !hostId) return;
    setBusy(true);
    setError(null);
    const result = privileged
      ? await admin({
          environmentId,
          input: { hostId: hostId ?? "unavailable", request: input as OpenbotAdminRequest },
        })
      : await write({ environmentId, input: { hostId, request: input as OpenbotWriteRequest } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      pendingMessage.current = null;
      setEditingMemory(null);
      setText("");
      setInputRevision((value) => value + 1);
      query.refresh();
    }
    setBusy(false);
  };
  const deleteBot = () =>
    Dialog.confirm({
      title: gt("Delete bot?"),
      message: gt("This deletes the bot and its conversations."),
      confirmText: gt("Delete bot"),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await admin({
            environmentId,
            input: {
              hostId: hostId ?? "unavailable",
              request: { operation: "agent.delete", agentId },
            },
          });
          if (result._tag === "Failure") {
            setError(String(squashAtomCommandFailure(result)));
            setBusy(false);
          } else navigation.goBack();
        })();
      },
    });
  const tasks = tab === "task" && selectedTask === null ? taskViews(query.data) : null;
  const memories = tab === "memory" ? memoryViews(query.data) : null;
  const routines = tab === "routine" ? routineViews(query.data) : null;
  if (host.data?.state !== "ready" || !hostId || host.data.hostId !== hostId) {
    return (
      <SettingsScreen title={name}>
        <View className="gap-3 p-5">
          <Text accessibilityRole="alert">
            <T>Reconnect to the original bot engine or select the bot again before continuing.</T>
          </Text>
          <Button label={gt("Refresh engine")} onPress={host.refresh} />
          <Button label={gt("Back to bots")} onPress={() => navigation.goBack()} />
        </View>
      </SettingsScreen>
    );
  }
  return (
    <SettingsScreen title={name}>
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        <BotAttention environmentId={environmentId} agentId={agentId} />
        <View className="flex-row flex-wrap gap-2">
          {(["conversation", "task", "memory", "routine"] as const).map((value) => (
            <Button
              key={value}
              label={
                value === "conversation"
                  ? gt("Chat")
                  : value === "task"
                    ? gt("Tasks")
                    : value === "memory"
                      ? gt("Memory")
                      : gt("Routines")
              }
              tone={tab === value ? "primary" : "secondary"}
              size="compact"
              onPress={() => {
                setTab(value);
                setSelectedTask(null);
                setEditingMemory(null);
                setText("");
                setInputRevision((revision) => revision + 1);
                setError(null);
              }}
            />
          ))}
        </View>
        <Button label={gt("Refresh")} size="compact" onPress={query.refresh} />
        {(error || query.error) && (
          <Text accessibilityRole="alert" className="text-danger">
            {error ?? query.error}
          </Text>
        )}
        {query.isPending && !query.data && (
          <Text>
            <T>Loading…</T>
          </Text>
        )}
        {selectedTask && (
          <Button
            label={gt("Back to tasks")}
            size="compact"
            tone="text"
            onPress={() => {
              setSelectedTask(null);
              setText("");
              setInputRevision((revision) => revision + 1);
            }}
          />
        )}
        {tasks?.length === 0 && (
          <Text className="text-foreground-muted">
            <T>No tasks yet. Start one below.</T>
          </Text>
        )}
        {memories?.length === 0 && (
          <Text className="text-foreground-muted">
            <T>No saved memories. Add something this bot should remember.</T>
          </Text>
        )}
        {routines?.length === 0 && (
          <Text className="text-foreground-muted">
            <T>No routines yet. Create one below.</T>
          </Text>
        )}
        {(tab === "conversation" || (tab === "task" && selectedTask !== null)) && (
          <BotConversationPanel
            environmentId={environmentId}
            hostId={hostId}
            agentId={agentId}
            taskId={tab === "task" ? selectedTask : null}
          />
        )}
        {tasks?.map((task) => (
          <View key={task.id} className="gap-2 rounded-xl bg-grouped-card p-3">
            <Text>{task.title}</Text>
            <Button
              label={gt("Open task")}
              size="compact"
              onPress={() => {
                setSelectedTask(task.id);
                setText("");
                setInputRevision((revision) => revision + 1);
              }}
            />
            <Text textRole="footnote" className="text-foreground-muted">
              {task.state}
              {task.outcome ? ` · ${task.outcome}` : ""}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={task.state === "closed" ? gt("Reopen") : gt("Close task")}
                size="compact"
                disabled={busy || !canWrite}
                onPress={() =>
                  void send({
                    operation: task.state === "closed" ? "task.reopen" : "task.close",
                    agentId,
                    taskId: task.id,
                  })
                }
              />
              {task.state === "running" && (
                <Button
                  label={gt("Stop")}
                  size="compact"
                  disabled={busy || !canWrite}
                  onPress={() => void send({ operation: "task.stop", agentId, taskId: task.id })}
                />
              )}
            </View>
          </View>
        ))}
        {memories?.map((memory) => (
          <View key={memory.id} className="gap-2 rounded-xl bg-grouped-card p-3">
            <Text selectable>{memory.text}</Text>
            <Button
              label={gt("Edit memory")}
              size="compact"
              tone="text"
              disabled={busy || !canAdmin}
              onPress={() => {
                setEditingMemory(memory.id);
                setText(memory.text);
                setInputRevision((revision) => revision + 1);
              }}
            />
            <Button
              label={gt("Delete memory")}
              size="compact"
              tone="text"
              disabled={busy || !canAdmin}
              onPress={() =>
                void send({ operation: "memory.delete", agentId, memoryId: memory.id }, true)
              }
            />
          </View>
        ))}
        {initialRoutineId && hostId && (
          <BotRoutineNotification
            environmentId={environmentId}
            hostId={hostId}
            agentId={agentId}
            routineId={initialRoutineId}
            {...(initialRoutineRunId === undefined ? {} : { runId: initialRoutineRunId })}
          />
        )}
        {routines?.map((routine) => (
          <View key={routine.id} className="gap-2 rounded-xl bg-grouped-card p-3">
            <Text>
              {routine.name} · {routine.active ? gt("Active") : gt("Paused")}
            </Text>
            <Text className="text-foreground-muted">{routine.instruction}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={routine.active ? gt("Pause") : gt("Resume")}
                size="compact"
                disabled={busy || !canAdmin || !canWrite}
                onPress={() =>
                  void send(
                    {
                      operation: "routine.update",
                      agentId,
                      routineId: routine.id,
                      input: { active: !routine.active },
                    },
                    true,
                  )
                }
              />
              <Button
                label={gt("Run now")}
                size="compact"
                disabled={busy || !canWrite}
                onPress={() =>
                  void send({ operation: "routine.test", agentId, routineId: routine.id })
                }
              />
            </View>
          </View>
        ))}
        {query.data !== null && query.data !== undefined && !tasks && !memories && !routines && (
          <Text accessibilityRole="alert">
            <T>
              This host returned an unsupported format. Update the integration before editing this
              view.
            </T>
          </Text>
        )}
        <Button
          label={
            configurationOpen
              ? gt("Hide bot configuration")
              : gt("Model, instructions and coding destinations")
          }
          tone="text"
          onPress={() => setConfigurationOpen(!configurationOpen)}
        />
        {configurationOpen && (
          <View className="gap-4">
            {hostId && (
              <BotSettingsEnvironment
                key={`${environmentId}:${hostId}:${agentId}`}
                environmentId={environmentId}
                hostId={hostId}
                agentId={agentId}
              />
            )}
            {hostId && (
              <BotProviderSettings
                environmentId={environmentId}
                agentId={agentId}
                hostId={hostId}
              />
            )}
            {hostId && (
              <BotConfiguration environmentId={environmentId} agentId={agentId} hostId={hostId} />
            )}
            {hostId && (
              <BotCodingPolicy
                key={`policy:${hostId}:${agentId}`}
                environmentId={environmentId}
                hostId={hostId}
                agentId={agentId}
              />
            )}
          </View>
        )}
        {hostId && (
          <>
            <DataEnvironment
              key={`data:${environmentId}:${hostId}`}
              environmentId={environmentId}
              hostId={hostId}
            />
            <ComputerEnvironment
              key={`${environmentId}:${hostId}`}
              environmentId={environmentId}
              hostId={hostId}
            />
            <BotBrowser
              key={`${environmentId}:${hostId}:${agentId}`}
              environmentId={environmentId}
              agentId={agentId}
              hostId={hostId}
            />
          </>
        )}
        {hostId && (
          <BotFiles
            key={`${hostId}:${agentId}`}
            environmentId={environmentId}
            hostId={hostId}
            agentId={agentId}
          />
        )}
        <SettingsSection title={gt("Coding work")}>
          <View className="gap-3 p-3">
            <Button label={gt("Refresh coding work")} size="compact" onPress={coding.refresh} />
            {coding.error && (
              <Text accessibilityRole="alert" className="text-danger">
                {coding.error}
              </Text>
            )}
            {coding.data?.length === 0 && (
              <Text className="text-foreground-muted">
                <T>Coding assignments delegated by this bot will appear here.</T>
              </Text>
            )}
            {coding.data?.map((task) => (
              <View key={`${task.origin.taskId}:${task.operationId}`} className="gap-2">
                <Button
                  label={gt("Open coding thread · {state}", { state: task.state })}
                  size="compact"
                  onPress={() =>
                    navigation.dispatch(
                      StackActions.push("Thread", { environmentId, threadId: task.threadId }),
                    )
                  }
                />
                {task.result && <Text selectable>{task.result}</Text>}
                {task.delivery?.state === "pending" && (
                  <Text textRole="footnote" className="text-foreground-muted">
                    <T>Result delivery to the bot is pending.</T>
                  </Text>
                )}
                {task.delivery?.state === "reconciliation-required" && (
                  <Text
                    accessibilityLiveRegion="polite"
                    textRole="footnote"
                    className="text-foreground-muted"
                  >
                    <T>The bot’s receipt needs review before this result can be sent again.</T>
                  </Text>
                )}
                {task.pendingRequestIds.length > 0 && (
                  <Text>
                    <T>This thread needs your input.</T>
                  </Text>
                )}
              </View>
            ))}
          </View>
        </SettingsSection>
        <Button
          label={gt("Delete bot")}
          size="compact"
          tone="danger"
          disabled={busy || !canAdmin}
          onPress={deleteBot}
        />
        {tab === "routine" && routines !== null && (
          <DailyRoutineForm
            environmentId={environmentId}
            agentId={agentId}
            hostId={hostId ?? "unavailable"}
            onCreated={query.refresh}
          />
        )}
        {tab !== "routine" && (tasks !== null || memories !== null) && (
          <View className="gap-2">
            <Text>
              {tab === "task" ? gt("New task") : editingMemory ? gt("Edit memory") : gt("Remember")}
            </Text>
            <AppTextInput
              key={`${tab}:${inputRevision}`}
              accessibilityLabel={
                tab === "task" ? gt("New task") : editingMemory ? gt("Edit memory") : gt("Remember")
              }
              defaultValue={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              maxLength={tab === "memory" ? 500 : 100000}
              className="min-h-24 rounded-xl bg-grouped-card p-3"
            />
            <Button
              label={
                tab === "task"
                  ? gt("Start task")
                  : editingMemory
                    ? gt("Save memory")
                    : gt("Add memory")
              }
              loading={busy}
              disabled={!text.trim() || (tab === "memory" ? !canAdmin : !canWrite)}
              onPress={() => {
                if (!text.trim()) return;
                const clientMessageId = messageIdFor(
                  `${tab}:${selectedTask ?? "main"}:${text.trim()}`,
                );
                void send(
                  tab === "memory"
                    ? editingMemory
                      ? {
                          operation: "memory.update",
                          agentId,
                          memoryId: editingMemory,
                          text: text.trim(),
                        }
                      : { operation: "memory.create", agentId, text: text.trim() }
                    : { operation: "task.start", agentId, text: text.trim(), clientMessageId },
                  tab === "memory",
                );
              }}
            />
          </View>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function DailyRoutineForm({
  environmentId,
  agentId,
  hostId,
  onCreated,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  hostId: string;
  onCreated: () => void;
}) {
  const gt = useGT();
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const canOperate = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [time, setTime] = useState("09:00");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const create = async () => {
    if (busy || !name.trim() || !instruction.trim() || !timezone.trim() || !validTime) return;
    setBusy(true);
    setError(null);
    const result = await admin({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "routine.create",
          agentId,
          input: {
            name: name.trim(),
            instruction: instruction.trim(),
            active: true,
            timezone: timezone.trim(),
            schedule: { kind: "daily", time },
          },
        },
      },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      setName("");
      setInstruction("");
      setRevision((value) => value + 1);
      onCreated();
    }
    setBusy(false);
  };
  return (
    <SettingsSection title={gt("Create daily routine")}>
      <View className="gap-3 p-3">
        <Text>
          <T>Name</T>
        </Text>
        <AppTextInput
          key={`name:${revision}`}
          accessibilityLabel={gt("Routine name")}
          defaultValue=""
          onChangeText={setName}
          maxLength={80}
          className="min-h-12 rounded-xl bg-sheet p-3"
        />
        <Text>
          <T>Instructions</T>
        </Text>
        <AppTextInput
          key={`instruction:${revision}`}
          accessibilityLabel={gt("Routine instructions")}
          defaultValue=""
          onChangeText={setInstruction}
          multiline
          textAlignVertical="top"
          maxLength={100000}
          className="min-h-24 rounded-xl bg-sheet p-3"
        />
        <Text>
          <T>Time (24-hour HH:MM)</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Routine time, 24-hour hours and minutes")}
          defaultValue="09:00"
          onChangeText={setTime}
          maxLength={5}
          keyboardType="numbers-and-punctuation"
          className="min-h-12 rounded-xl bg-sheet p-3"
        />
        {!validTime && (
          <Text accessibilityRole="alert" className="text-danger">
            <T>Enter a time such as 09:00 or 17:30.</T>
          </Text>
        )}
        <Text>
          <T>Time zone</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Routine time zone")}
          defaultValue={timezone}
          onChangeText={setTimezone}
          maxLength={512}
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-12 rounded-xl bg-sheet p-3"
        />
        {error && (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        )}
        <Button
          label={gt("Create routine")}
          loading={busy}
          disabled={
            !canAdmin ||
            !canOperate ||
            !name.trim() ||
            !instruction.trim() ||
            !timezone.trim() ||
            !validTime
          }
          onPress={() => void create()}
        />
      </View>
    </SettingsSection>
  );
}

export function SettingsBotProvidersRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: EnvironmentId; hostId: string }>) {
  const gt = useGT();
  return (
    <SettingsScreen title={gt("Bot providers")}>
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        <BotProviderSetup
          key={route.params.hostId}
          environmentId={route.params.environmentId}
          hostId={route.params.hostId}
        />
      </ScreenScrollView>
    </SettingsScreen>
  );
}
