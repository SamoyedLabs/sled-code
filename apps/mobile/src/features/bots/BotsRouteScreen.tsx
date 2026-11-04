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
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useRef, useState } from "react";
import { View } from "react-native";
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
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "../settings/components/SettingsEnvironmentFilterHeader";
import {
  useSettingsEnvironmentFilter,
  type SettingsTarget,
} from "../settings/settings-environment-filter";

export function SettingsBotsRouteScreen() {
  return <BotsRouteScreen />;
}

export function BotWorkspaceRouteScreen() {
  return <BotsRouteScreen workspace />;
}

function BotsRouteScreen({ workspace = false }: { workspace?: boolean }) {
  const navigation = useNavigation();
  const { selectedTargets, availableTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Bots" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScreenScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-5 px-5 py-4"
        >
          <Text className="text-foreground-muted">
            Persistent teammates for ongoing responsibilities, tasks, and coding work.
          </Text>
          <Button
            label={workspace ? "Engine and provider settings" : "Open bot workspace"}
            tone="secondary"
            onPress={() => navigation.navigate(workspace ? "SettingsBots" : "Bots")}
          />
          {selectedTargets.map((environment) => (
            <BotEnvironment
              key={environment.environmentId}
              environment={environment}
              workspace={workspace}
            />
          ))}
          {selectedTargets.length === 0 && (
            <Text>
              {availableTargets.length === 0
                ? "Connect an environment to manage its bots."
                : "No environments match these filters."}
            </Text>
          )}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function BotEnvironment({
  environment,
  workspace = false,
}: {
  environment: SettingsTarget;
  workspace?: boolean;
}) {
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
        input: { name: "permission check", description: "", initialMessage: "permission check" },
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
  return (
    <SettingsSection title={environment.label}>
      <View className="gap-3 p-4">
        <Text accessibilityLiveRegion="polite">
          {host.isPending
            ? "Checking bot engine…"
            : state === "ready"
              ? "Bot engine online"
              : state === "disabled"
                ? "Bot engine is not configured on this environment"
                : state === "starting"
                  ? "Bot engine is starting…"
                  : state === "failed"
                    ? `Bot engine failed: ${host.data?.reason ?? "unknown"}`
                    : "Bot engine stopped"}
        </Text>
        {(error || host.error || agents.error) && (
          <Text accessibilityRole="alert" className="text-danger">
            {error ?? host.error ?? agents.error}
          </Text>
        )}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Refresh"
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
                  ? "Starting…"
                  : state === "ready"
                    ? "Enable automatic startup"
                    : host.data?.desiredRunning
                      ? "Retry engine"
                      : "Start engine"
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
              label={engineBusy === "stop" ? "Stopping…" : "Stop engine"}
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
            Settings permission is required to start or stop this engine.
          </Text>
        )}
        {!workspace && (
          <>
            <BotRuntimeControls environmentId={environmentId} />
            <OpenbotMaintenance environmentId={environmentId} />
            {state === "ready" && <SledToolsConnection environmentId={environment.environmentId} />}
          </>
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
                    ? "Bots"
                    : value === "approvals"
                      ? "Needs attention"
                      : value === "channels"
                        ? "Channels"
                        : "Workflows"
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
        {!workspace && state === "ready" && host.data?.hostId && (
          <Button
            label="Provider setup"
            tone="secondary"
            onPress={() => {
              if (host.data?.hostId)
                navigation.navigate("SettingsBotProviders", {
                  environmentId,
                  hostId: host.data.hostId,
                });
            }}
          />
        )}
        {workspace && view === "bots" && state === "ready" && (
          <>
            <Button
              label="Create bot"
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
            {agents.isPending && !agents.data && <Text>Loading bots…</Text>}
            {agents.data?.length === 0 && (
              <Text className="text-foreground-muted">
                No bots yet. Create one and give it a responsibility.
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
        input: { name: "permission check", description: "", initialMessage: "permission check" },
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
    <SettingsScreen title="Create bot">
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        <Text>Name</Text>
        <AppTextInput
          accessibilityLabel="Bot name"
          defaultValue=""
          onChangeText={setName}
          maxLength={80}
          className="min-h-12 rounded-xl bg-grouped-card p-3"
        />
        <Text>Responsibility and instructions</Text>
        <AppTextInput
          accessibilityLabel="Responsibility and instructions"
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
          Creating a bot sends its first message using the selected model and the provider's own
          sign-in. Other accounts can be assigned after creation.
        </Text>
        <Button
          label="Provider setup"
          tone="secondary"
          onPress={() =>
            navigation.navigate("SettingsBotProviders", { environmentId, hostId: expectedHostId })
          }
        />
        <Button
          label="Refresh providers"
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
              "The bot engine changed. Reopen this form before creating a bot."}
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        )}
        <Button
          label="Create bot"
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
function BotDetail({
  environmentId,
  agentId,
  name,
  hostId,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  name: string;
  hostId?: string;
}) {
  const pendingMessage = useRef<{ text: string; id: string } | null>(null);
  const messageIdFor = (value: string) => {
    if (pendingMessage.current?.text !== value)
      pendingMessage.current = { text: value, id: Crypto.randomUUID() };
    return pendingMessage.current.id;
  };
  const navigation = useNavigation();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [tab, setTab] = useState<BotTab>("conversation");
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
      title: "Delete bot?",
      message: "This deletes the bot and its conversations.",
      confirmText: "Delete bot",
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
            Reconnect to the original bot engine or select the bot again before continuing.
          </Text>
          <Button label="Refresh engine" onPress={host.refresh} />
          <Button label="Back to bots" onPress={() => navigation.goBack()} />
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
                  ? "Chat"
                  : value === "task"
                    ? "Tasks"
                    : value === "memory"
                      ? "Memory"
                      : "Routines"
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
        <Button label="Refresh" size="compact" onPress={query.refresh} />
        {(error || query.error) && (
          <Text accessibilityRole="alert" className="text-danger">
            {error ?? query.error}
          </Text>
        )}
        {query.isPending && !query.data && <Text>Loading…</Text>}
        {selectedTask && (
          <Button
            label="Back to tasks"
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
          <Text className="text-foreground-muted">No tasks yet. Start one below.</Text>
        )}
        {memories?.length === 0 && (
          <Text className="text-foreground-muted">
            No saved memories. Add something this bot should remember.
          </Text>
        )}
        {routines?.length === 0 && (
          <Text className="text-foreground-muted">No routines yet. Create one below.</Text>
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
              label="Open task"
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
                label={task.state === "closed" ? "Reopen" : "Close task"}
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
                  label="Stop"
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
              label="Edit memory"
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
              label="Delete memory"
              size="compact"
              tone="text"
              disabled={busy || !canAdmin}
              onPress={() =>
                void send({ operation: "memory.delete", agentId, memoryId: memory.id }, true)
              }
            />
          </View>
        ))}
        {routines?.map((routine) => (
          <View key={routine.id} className="gap-2 rounded-xl bg-grouped-card p-3">
            <Text>
              {routine.name} · {routine.active ? "Active" : "Paused"}
            </Text>
            <Text className="text-foreground-muted">{routine.instruction}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={routine.active ? "Pause" : "Resume"}
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
                label="Run now"
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
            This host returned an unsupported format. Update the integration before editing this
            view.
          </Text>
        )}
        <Button
          label={
            configurationOpen
              ? "Hide bot configuration"
              : "Model, instructions and coding destinations"
          }
          tone="text"
          onPress={() => setConfigurationOpen(!configurationOpen)}
        />
        {configurationOpen && (
          <View className="gap-4">
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
        <SettingsSection title="Coding work">
          <View className="gap-3 p-3">
            <Button label="Refresh coding work" size="compact" onPress={coding.refresh} />
            {coding.error && (
              <Text accessibilityRole="alert" className="text-danger">
                {coding.error}
              </Text>
            )}
            {coding.data?.length === 0 && (
              <Text className="text-foreground-muted">
                Coding assignments delegated by this bot will appear here.
              </Text>
            )}
            {coding.data?.map((task) => (
              <View key={`${task.origin.taskId}:${task.operationId}`} className="gap-2">
                <Button
                  label={`Open coding thread · ${task.state}`}
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
                    Result delivery to the bot is pending.
                  </Text>
                )}
                {task.delivery?.state === "reconciliation-required" && (
                  <Text
                    accessibilityLiveRegion="polite"
                    textRole="footnote"
                    className="text-foreground-muted"
                  >
                    The bot’s receipt needs review before this result can be sent again.
                  </Text>
                )}
                {task.pendingRequestIds.length > 0 && <Text>This thread needs your input.</Text>}
              </View>
            ))}
          </View>
        </SettingsSection>
        <Button
          label="Delete bot"
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
            <Text>{tab === "task" ? "New task" : editingMemory ? "Edit memory" : "Remember"}</Text>
            <AppTextInput
              key={`${tab}:${inputRevision}`}
              accessibilityLabel={
                tab === "task" ? "New task" : editingMemory ? "Edit memory" : "Remember"
              }
              defaultValue={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              maxLength={tab === "memory" ? 500 : 100000}
              className="min-h-24 rounded-xl bg-grouped-card p-3"
            />
            <Button
              label={tab === "task" ? "Start task" : editingMemory ? "Save memory" : "Add memory"}
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
    <SettingsSection title="Create daily routine">
      <View className="gap-3 p-3">
        <Text>Name</Text>
        <AppTextInput
          key={`name:${revision}`}
          accessibilityLabel="Routine name"
          defaultValue=""
          onChangeText={setName}
          maxLength={80}
          className="min-h-12 rounded-xl bg-sheet p-3"
        />
        <Text>Instructions</Text>
        <AppTextInput
          key={`instruction:${revision}`}
          accessibilityLabel="Routine instructions"
          defaultValue=""
          onChangeText={setInstruction}
          multiline
          textAlignVertical="top"
          maxLength={100000}
          className="min-h-24 rounded-xl bg-sheet p-3"
        />
        <Text>Time (24-hour HH:MM)</Text>
        <AppTextInput
          accessibilityLabel="Routine time, 24-hour hours and minutes"
          defaultValue="09:00"
          onChangeText={setTime}
          maxLength={5}
          keyboardType="numbers-and-punctuation"
          className="min-h-12 rounded-xl bg-sheet p-3"
        />
        {!validTime && (
          <Text accessibilityRole="alert" className="text-danger">
            Enter a time such as 09:00 or 17:30.
          </Text>
        )}
        <Text>Time zone</Text>
        <AppTextInput
          accessibilityLabel="Routine time zone"
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
          label="Create routine"
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
  return (
    <SettingsScreen title="Bot providers">
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
