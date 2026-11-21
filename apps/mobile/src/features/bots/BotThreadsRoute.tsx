import type { StaticScreenProps } from "@react-navigation/native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { randomUUID } from "expo-crypto";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { taskViews } from "@t3tools/client-runtime/openbot/presentation";
import { Keyboard, Platform, Pressable, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotNativeConversation } from "./BotNativeConversation";
import { useBotMessagePinsCapability } from "./BotPinnedMessages";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { BotOfflineHistory } from "./BotOfflineHistory";
import { useBotEnvironmentOnline } from "./botOfflineCache";
import { BotIconButton } from "./upstream/BotChrome";
import { OpenBotTypography } from "./upstream/OpenBotTypography";
import { BotMessageComposer, useBotKeyboardAvoidance } from "./upstream/BotMessageComposer";
import { T, useGT } from "gt-react-native";

type Agent = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  name: string;
  avatarSeed?: string;
  avatarHue?: number | null;
};
type AgentThread = Agent & { taskId: string | null; title: string; initialMessageId?: string };
const decodeCreated = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    agentId: Schema.String,
  }),
);

function BotThreadRenameSheet({
  initialTitle,
  busy,
  error,
  onClose,
  onSave,
}: {
  initialTitle: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const gt = useGT();
  const [title, setTitle] = useState(initialTitle);
  const trimmed = title.trim();
  const canSave = !busy && trimmed.length > 0 && trimmed.length <= 120;
  return (
    <Sheet title={gt("Rename thread")} onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-4 py-5"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            <T>Thread title</T>
          </Text>
          <AppTextInput
            accessibilityLabel={gt("Thread title")}
            autoFocus
            editable={!busy}
            maxLength={120}
            placeholder={gt("Enter a thread title")}
            returnKeyType="done"
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={() => {
              if (canSave) void onSave(trimmed);
            }}
            className="rounded-xl bg-grouped-card px-3.5 py-3 text-base text-foreground"
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label={gt("Cancel")} tone="secondary" disabled={busy} onPress={onClose} />
          </View>
          <View className="flex-1">
            <Button
              label={busy ? gt("Saving…") : gt("Save")}
              tone="primary"
              disabled={!canSave}
              onPress={() => void onSave(trimmed)}
            />
          </View>
        </View>
      </ScreenScrollView>
    </Sheet>
  );
}

export function BotThreadsRoute({ route }: StaticScreenProps<Agent>) {
  const gt = useGT();
  const navigation = useNavigation();
  const { environmentId, hostId, agentId } = route.params;
  const insets = useSafeAreaInsets();
  const composerBottomPadding = Math.max(insets.bottom, 10);
  const keyboardAvoidance = useBotKeyboardAvoidance(composerBottomPadding);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const attempt = useRef<{ clientMessageId: string; text: string } | null>(null);
  const active = useRef(false);
  const start = useAtomCommand(openbot.newTaskStart, { reportFailure: false });
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const canStart = useAtomValue(openbot.newTaskStart.permissionAtom(environmentId));
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const result = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "task.list", agentId } },
    }),
  );
  const rows = taskViews(result.data);
  const openThread = (taskId: string, title: string) =>
    navigation.dispatch(StackActions.replace("BotAgentThread", { ...route.params, taskId, title }));
  const renameThread = async (taskId: string, title: string) => {
    if (manageBusy || !canWrite) return;
    setManageBusy(true);
    setManageError(null);
    await (async () => {
      const response = await write({
        environmentId,
        input: { hostId, request: { operation: "thread.rename", agentId, taskId, title } },
      });
      if (response._tag !== "Success") {
        setManageError(
          gt("Could not rename this thread. Check the host connection and try again."),
        );
        return;
      }
      setRenaming(null);
      result.refresh();
    })()
      .catch(() => {
        setManageError(
          gt("Could not rename this thread. Check the host connection and try again."),
        );
      })
      .finally(() => {
        setManageBusy(false);
      });
  };
  const deleteThread = (taskId: string) => {
    if (manageBusy || !canWrite) return;
    Dialog.confirm({
      title: gt("Delete this thread?"),
      message: gt(
        "OpenBot deletes the thread, its messages and its files for good. The main chat does not change.",
      ),
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        setManageBusy(true);
        void (async () => {
          const response = await write({
            environmentId,
            input: { hostId, request: { operation: "thread.delete", agentId, taskId } },
          });
          if (response._tag !== "Success") {
            Dialog.alert(gt("Could not delete thread"), gt("The host refused the request."));
            return;
          }
          result.refresh();
        })()
          .catch(() => {
            Dialog.alert(gt("Could not delete thread"), gt("The host refused the request."));
          })
          .finally(() => {
            setManageBusy(false);
          });
      },
    });
  };
  const submit = async (message: string) => {
    if (active.current || !canStart || !message.trim()) return;
    const request = attempt.current ?? { clientMessageId: randomUUID(), text: message.trim() };
    attempt.current = request;
    active.current = true;
    setBusy(true);
    setFailed(false);
    await (async () => {
      const response = await start({ environmentId, input: { hostId, agentId, ...request } });
      const created = response._tag === "Success" ? decodeCreated(response.value) : null;
      if (created?._tag !== "Some" || created.value.agentId !== agentId) {
        setFailed(true);
        return;
      }
      attempt.current = null;
      Keyboard.dismiss();
      if (navigation.isFocused()) openThread(created.value.id, "Thread");
    })()
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        active.current = false;
        setBusy(false);
      });
  };
  if (composing) {
    return (
      <OpenBotTypography>
        <Animated.View
          style={[
            {
              flex: 1,
              justifyContent: "flex-end",
              gap: 8,
              paddingHorizontal: 12,
            },
            keyboardAvoidance,
          ]}
        >
          <NativeStackScreenOptions options={{ title: gt("New thread") }} />
          {failed && (
            <Text accessibilityRole="alert">
              <T>The host has not confirmed this thread. Send again to retry the same request.</T>
            </Text>
          )}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              paddingBottom: composerBottomPadding,
            }}
          >
            <BotMessageComposer
              label={gt("First message")}
              text={text}
              onChangeText={setText}
              editable={!busy && !failed}
              action="send"
              actionDisabled={busy || !canStart || !text.trim()}
              onAction={submit}
              showVoiceControl={false}
            />
          </View>
        </Animated.View>
      </OpenBotTypography>
    );
  }
  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 px-4 py-4"
    >
      <NativeStackScreenOptions options={{ title: route.params.name + " threads" }} />
      {renaming ? (
        <BotThreadRenameSheet
          key={renaming.id}
          initialTitle={renaming.title}
          busy={manageBusy}
          error={manageError}
          onClose={() => {
            if (!manageBusy) {
              setRenaming(null);
              setManageError(null);
            }
          }}
          onSave={(nextTitle) => renameThread(renaming.id, nextTitle)}
        />
      ) : null}
      <SettingsSection>
        <ListActionRow
          icon="plus"
          label={gt("New thread")}
          disabled={!canStart}
          onPress={() => setComposing(true)}
        />
      </SettingsSection>
      {rows?.length ? (
        <SettingsSection>
          {rows.map((row) => {
            const label = row.title || "Untitled thread";
            return (
              <ReanimatedSwipeable
                key={row.id}
                enabled={canWrite && !manageBusy}
                overshootRight={false}
                renderRightActions={() => (
                  <Pressable
                    onPress={() => deleteThread(row.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${label}`}
                    className="justify-center bg-red-700 px-4"
                  >
                    <Text className="text-white">Delete</Text>
                  </Pressable>
                )}
              >
                <View className="flex-row items-center bg-grouped-card">
                  <View className="flex-1">
                    <ListActionRow
                      icon="text.bubble"
                      label={label}
                      detail={row.state}
                      onPress={() => openThread(row.id, row.title || "Thread")}
                    />
                  </View>
                  {canWrite ? (
                    <Menu
                      actions={[
                        { id: "rename", title: gt("Rename thread") },
                        {
                          id: "delete",
                          title: gt("Delete thread"),
                          attributes: { destructive: true },
                        },
                      ]}
                      onPressAction={({ nativeEvent }) => {
                        if (nativeEvent.event === "rename") {
                          setManageError(null);
                          setRenaming({ id: row.id, title: row.title });
                        }
                        if (nativeEvent.event === "delete") deleteThread(row.id);
                      }}
                    >
                      <View className="pe-2">
                        <BotIconButton
                          label={gt("Thread actions for {label}", { label })}
                          icon="ellipsis"
                          disabled={manageBusy}
                        />
                      </View>
                    </Menu>
                  ) : null}
                </View>
              </ReanimatedSwipeable>
            );
          })}
        </SettingsSection>
      ) : (
        <Text className="p-4 text-foreground-muted">
          {result.error ??
            (result.isPending
              ? gt("Loading threads…")
              : rows
                ? gt("No threads yet")
                : gt("Threads unavailable"))}
        </Text>
      )}
    </ScreenScrollView>
  );
}

export function BotAgentThreadRoute({ route }: StaticScreenProps<AgentThread>) {
  const gt = useGT();
  const {
    environmentId,
    hostId,
    agentId,
    taskId,
    title: initialTitle,
    name,
    avatarSeed,
    avatarHue,
    initialMessageId,
  } = route.params;
  const navigation = useNavigation();
  const [title, setTitle] = useState(initialTitle);
  const [renaming, setRenaming] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const canOpenPins = useBotMessagePinsCapability({ environmentId, hostId });
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const online = useBotEnvironmentOnline(environmentId);
  const status = useEnvironmentQuery(online ? openbot.status({ environmentId, input: {} }) : null);
  const ready = status.data?.state === "ready" && status.data.hostId === hostId;
  const canManageThread = Boolean(taskId && ready && canWrite);

  const renameThread = async (nextTitle: string) => {
    if (!taskId || manageBusy || !canWrite) return;
    setManageBusy(true);
    setManageError(null);
    await (async () => {
      const response = await write({
        environmentId,
        input: {
          hostId,
          request: { operation: "thread.rename", agentId, taskId, title: nextTitle },
        },
      });
      if (response._tag !== "Success") {
        setManageError(
          gt("Could not rename this thread. Check the host connection and try again."),
        );
        return;
      }
      setTitle(nextTitle);
      setRenaming(false);
    })()
      .catch(() => {
        setManageError(
          gt("Could not rename this thread. Check the host connection and try again."),
        );
      })
      .finally(() => {
        setManageBusy(false);
      });
  };

  const deleteThread = () => {
    if (!taskId || manageBusy || !canWrite) return;
    Dialog.confirm({
      title: gt("Delete this thread?"),
      message: gt(
        "OpenBot deletes the thread, its messages and its files for good. The main chat does not change.",
      ),
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        setManageBusy(true);
        void (async () => {
          const response = await write({
            environmentId,
            input: { hostId, request: { operation: "thread.delete", agentId, taskId } },
          });
          if (response._tag !== "Success") {
            Dialog.alert(gt("Could not delete thread"), gt("The host refused the request."));
            return;
          }
          if (navigation.isFocused()) navigation.goBack();
        })()
          .catch(() => {
            Dialog.alert(gt("Could not delete thread"), gt("The host refused the request."));
          })
          .finally(() => {
            setManageBusy(false);
          });
      },
    });
  };

  const headerRightItems = () => {
    const items = [];
    if (canOpenPins) {
      items.push(
        withNativeGlassHeaderItem({
          type: "button" as const,
          label: gt("Pinned messages"),
          icon: { name: "pin" as const, type: "sfSymbol" as const },
          onPress: () => navigation.navigate("BotPinnedMessages", route.params),
        }),
      );
    }
    if (canManageThread) {
      items.push(
        withNativeGlassHeaderItem({
          type: "menu" as const,
          label: "",
          accessibilityLabel: gt("Thread options"),
          icon: { name: "ellipsis" as const, type: "sfSymbol" as const },
          menu: {
            title: gt("Thread"),
            items: [
              {
                type: "action" as const,
                label: gt("Rename thread"),
                onPress: () => {
                  setManageError(null);
                  setRenaming(true);
                },
              },
              {
                type: "action" as const,
                label: gt("Delete thread"),
                destructive: true,
                onPress: deleteThread,
              },
            ],
          },
        }),
      );
    }
    return items;
  };

  return (
    <View className="flex-1">
      <NativeStackScreenOptions
        options={{
          title,
          ...(Platform.OS === "ios" && (canOpenPins || canManageThread)
            ? { unstable_headerRightItems: headerRightItems }
            : {}),
        }}
      />
      {renaming && taskId ? (
        <BotThreadRenameSheet
          initialTitle={title}
          busy={manageBusy}
          error={manageError}
          onClose={() => {
            if (!manageBusy) {
              setRenaming(false);
              setManageError(null);
            }
          }}
          onSave={renameThread}
        />
      ) : null}
      {ready ? (
        <OpenBotTypography>
          <BotNativeConversation
            environmentId={environmentId}
            hostId={hostId}
            agentId={agentId}
            name={name}
            taskId={taskId}
            initialMessageId={initialMessageId}
            avatarSeed={avatarSeed}
            avatarHue={avatarHue}
          />
        </OpenBotTypography>
      ) : status.data?.state === "ready" ? (
        <Text className="p-4 text-foreground-muted">
          <T>Reconnect to this bot’s computer to see the thread.</T>
        </Text>
      ) : (
        <OpenBotTypography>
          <BotOfflineHistory
            environmentId={environmentId}
            hostId={hostId}
            chat={{ kind: "agent", id: agentId, taskId }}
            connecting={status.isPending}
          />
        </OpenBotTypography>
      )}
    </View>
  );
}
