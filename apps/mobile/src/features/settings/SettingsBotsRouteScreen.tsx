import { BotAttention } from "./BotAttention";
import { SledToolsConnection } from "./SledToolsConnection";
import { BotConfiguration } from "./BotConfiguration";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import type { EnvironmentId, OpenbotAdminRequest, OpenbotWriteRequest } from "@t3tools/contracts";
import {
  botViewRequest,
  conversationView,
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
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

export function SettingsBotsRouteScreen() {
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
          {selectedTargets.map((environment) => (
            <BotEnvironment key={environment.environmentId} environment={environment} />
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

function BotEnvironment({ environment }: { environment: SettingsTarget }) {
  const environmentId = environment.environmentId;
  const navigation = useNavigation();
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(
    host.data?.state === "ready" ? openbot.agents({ environmentId, input: {} }) : null,
  );
  const canManage = useAtomValue(openbot.start.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const start = useAtomCommand(openbot.start, { reportFailure: false });
  const stop = useAtomCommand(openbot.stop, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await (host.data?.state === "ready" ? stop : start)({
      environmentId,
      input: {},
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
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
            disabled={busy}
            onPress={() => {
              host.refresh();
              agents.refresh();
            }}
          />
          {state && state !== "disabled" && (
            <Button
              label={state === "ready" ? "Stop engine" : "Start engine"}
              size="compact"
              loading={busy}
              disabled={!canManage || state === "starting"}
              onPress={() => void act()}
            />
          )}
        </View>
        {!canManage && state !== "disabled" && (
          <Text textRole="footnote" className="text-foreground-muted">
            Settings permission is required to start or stop this engine.
          </Text>
        )}
        {state === "ready" && <SledToolsConnection environmentId={environment.environmentId} />}
        {state === "ready" && <BotAttention environmentId={environmentId} />}
        {state === "ready" && (
          <>
            <Button
              label="Create bot"
              icon="plus"
              size="compact"
              disabled={!canAdmin || busy}
              onPress={() => navigation.navigate("SettingsBotNew", { environmentId })}
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
}: StaticScreenProps<{ environmentId: EnvironmentId }>) {
  const environmentId = route.params.environmentId;
  const navigation = useNavigation();
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.admin, { reportFailure: false });
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (busy || !name.trim() || !instructions.trim()) return;
    setBusy(true);
    setError(null);
    const result = await admin({
      environmentId,
      input: {
        operation: "agent.create",
        input: {
          name: name.trim(),
          description: instructions.trim(),
          initialMessage: instructions.trim(),
        },
      },
    });
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
        {error && (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        )}
        <Button
          label="Create bot"
          loading={busy}
          disabled={!canAdmin || !name.trim() || !instructions.trim()}
          onPress={() => void create()}
        />
      </ScreenScrollView>
    </SettingsScreen>
  );
}

type BotTab = "conversation" | "task" | "memory" | "routine";
export function SettingsBotDetailRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: EnvironmentId; agentId: string; name: string }>) {
  return (
    <BotDetail key={`${route.params.environmentId}:${route.params.agentId}`} {...route.params} />
  );
}
function BotDetail({
  environmentId,
  agentId,
  name,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  name: string;
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
  const [text, setText] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    openbot.read({
      environmentId,
      input: botViewRequest(agentId, tab, selectedTask),
    }),
  );
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const coding = useEnvironmentQuery(
    host.data?.hostId
      ? openbot.codingTasks({ environmentId, input: { hostId: host.data.hostId, agentId } })
      : null,
  );
  const canWrite = useAtomValue(openbot.write.permissionAtom(environmentId));
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.write, { reportFailure: false });
  const admin = useAtomCommand(openbot.admin, { reportFailure: false });
  const send = async (input: OpenbotWriteRequest | OpenbotAdminRequest, privileged = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = privileged
      ? await admin({ environmentId, input: input as OpenbotAdminRequest })
      : await write({ environmentId, input: input as OpenbotWriteRequest });
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
            input: { operation: "agent.delete", agentId },
          });
          if (result._tag === "Failure") {
            setError(String(squashAtomCommandFailure(result)));
            setBusy(false);
          } else navigation.goBack();
        })();
      },
    });
  const conversation =
    tab === "conversation" || (tab === "task" && selectedTask !== null)
      ? conversationView(query.data)
      : null;
  const tasks = tab === "task" && selectedTask === null ? taskViews(query.data) : null;
  const memories = tab === "memory" ? memoryViews(query.data) : null;
  const routines = tab === "routine" ? routineViews(query.data) : null;
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
        {conversation?.messages.length === 0 && (
          <Text className="text-foreground-muted">
            No messages yet. Give this bot its first assignment.
          </Text>
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
        {conversation && (
          <>
            {conversation.messages.map((message) => (
              <View key={message.id} className="gap-1 rounded-xl bg-grouped-card p-3">
                <Text textRole="footnote" className="capitalize text-foreground-muted">
                  {message.author} · {message.status}
                </Text>
                <Text selectable>{message.text}</Text>
              </View>
            ))}
            {conversation.activeTurnId && (
              <Button
                label="Stop current turn"
                disabled={busy || !canWrite}
                onPress={() =>
                  void send(
                    selectedTask
                      ? { operation: "task.stop", agentId, taskId: selectedTask }
                      : {
                          operation: "conversation.stop",
                          agentId,
                          turnId: conversation.activeTurnId!,
                        },
                  )
                }
              />
            )}
          </>
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
                disabled={busy || !canAdmin}
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
        {query.data !== null &&
          query.data !== undefined &&
          !conversation &&
          !tasks &&
          !memories &&
          !routines && (
            <Text accessibilityRole="alert">
              This host returned an unsupported format. Update the integration before editing this
              view.
            </Text>
          )}
        <BotConfiguration environmentId={environmentId} agentId={agentId} />
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
            onCreated={query.refresh}
          />
        )}
        {tab !== "routine" && (conversation !== null || tasks !== null || memories !== null) && (
          <View className="gap-2">
            <Text>
              {tab === "conversation"
                ? "Message"
                : tab === "task"
                  ? selectedTask
                    ? "Message task"
                    : "New task"
                  : editingMemory
                    ? "Edit memory"
                    : "Remember"}
            </Text>
            <AppTextInput
              key={`${tab}:${inputRevision}`}
              accessibilityLabel={
                tab === "conversation"
                  ? "Message"
                  : tab === "task"
                    ? selectedTask
                      ? "Message task"
                      : "New task"
                    : editingMemory
                      ? "Edit memory"
                      : "Remember"
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
                tab === "conversation"
                  ? "Send"
                  : tab === "task"
                    ? selectedTask
                      ? "Send"
                      : "Start task"
                    : editingMemory
                      ? "Save memory"
                      : "Add memory"
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
                    : tab === "task" && selectedTask
                      ? {
                          operation: "task.send",
                          agentId,
                          taskId: selectedTask,
                          text: text.trim(),
                          clientMessageId,
                        }
                      : {
                          operation: tab === "task" ? "task.start" : "conversation.send",
                          agentId,
                          text: text.trim(),
                          clientMessageId,
                        },
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
  onCreated,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  onCreated: () => void;
}) {
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.admin, { reportFailure: false });
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
            !canAdmin || !name.trim() || !instruction.trim() || !timezone.trim() || !validTime
          }
          onPress={() => void create()}
        />
      </View>
    </SettingsSection>
  );
}
