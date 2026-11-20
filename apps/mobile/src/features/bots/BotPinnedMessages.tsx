import { useAtomValue } from "@effect/atom-react";
import {
  OPENBOT_MESSAGE_PINS_CAPABILITY,
  OpenbotPinnedMessages,
  type EnvironmentId,
} from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Schema from "effect/Schema";
import { Platform, Pressable, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { SettingsSection } from "../settings/components/SettingsSection";

type Scope = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  name: string;
  taskId?: string | null | undefined;
  avatarSeed?: string | undefined;
  avatarHue?: number | null | undefined;
};
const decode = Schema.decodeUnknownOption(OpenbotPinnedMessages);

export function useBotMessagePinsCapability(scope: Pick<Scope, "environmentId" | "hostId"> | null) {
  const result = useEnvironmentQuery(
    scope
      ? openbot.readFromHost({
          environmentId: scope.environmentId,
          input: { hostId: scope.hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  return settingsCapabilities(result.data).includes(OPENBOT_MESSAGE_PINS_CAPABILITY);
}

export function useBotMessagePins(
  scope: Pick<Scope, "environmentId" | "hostId" | "agentId">,
  enabled: boolean,
) {
  const { environmentId, hostId, agentId } = scope;
  const input = { hostId, request: { operation: "conversation.pins.list" as const, agentId } };
  const query = useEnvironmentQuery(
    enabled ? openbot.readFromHost({ environmentId, input }) : null,
  );
  const canWrite = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const data = decode(query.data);
  const pins = data._tag === "Some" && data.value.agentId === agentId ? data.value.pins : null;
  return {
    pins,
    loading: query.isPending,
    canWrite: enabled && canWrite && pins !== null,
    retry: query.refresh,
    setPinned: async (taskId: string | null, messageId: string, pinned: boolean) => {
      if (!enabled || !canWrite) return;
      await (async () => {
        const result = await write({
          environmentId,
          input: {
            hostId,
            request: { operation: "conversation.pins.set", agentId, taskId, messageId, pinned },
          },
        });
        const received = result._tag === "Success" ? decode(result.value) : null;
        if (
          received?._tag !== "Some" ||
          received.value.agentId !== agentId ||
          received.value.pins.some(
            (pin) => pin.taskId === taskId && pin.messageId === messageId,
          ) !== pinned
        )
          throw new Error("Unconfirmed pin");
      })()
        .catch(() => {
          Dialog.alert(pinned ? "Could not pin the message" : "Could not unpin the message");
        })
        .finally(() => {
          query.refresh();
        });
    },
  };
}

export function BotPinnedMessagesRoute({ route }: StaticScreenProps<Scope>) {
  const scope = route.params;
  const currentTask = scope.taskId ?? null;
  const navigation = useNavigation();
  const online = useBotMessagePinsCapability(scope);
  const { pins, loading, canWrite, retry, setPinned } = useBotMessagePins(scope, online);
  const rows = pins
    ? [
        ...pins.filter((pin) => pin.taskId === currentTask),
        ...pins.filter((pin) => pin.taskId !== currentTask),
      ]
    : null;
  return (
    <ScreenScrollView contentContainerClassName="gap-4 px-4 py-5">
      {Platform.OS === "ios" && (
        <NativeStackScreenOptions
          options={{
            unstable_headerRightItems: () => [
              withNativeGlassHeaderItem({
                type: "button",
                label: "",
                accessibilityLabel: "Close pinned messages",
                icon: { type: "sfSymbol", name: "xmark" },
                onPress: () => navigation.goBack(),
              }),
            ],
          }}
        />
      )}
      {rows?.length ? (
        <SettingsSection>
          {rows.map((pin) => {
            const unpin = () => void setPinned(pin.taskId, pin.messageId, false);
            const author = pin.author === "user" ? (pin.sender?.name ?? "You") : scope.name;
            const pinnedBy =
              pin.pinnedBy.kind === "person" ? pin.pinnedBy.sender?.name : scope.name;
            return (
              <ReanimatedSwipeable
                key={JSON.stringify([pin.taskId, pin.messageId])}
                enabled={canWrite}
                overshootRight={false}
                renderRightActions={() => (
                  <Pressable
                    onPress={unpin}
                    accessibilityRole="button"
                    accessibilityLabel="Unpin message"
                    className="justify-center bg-red-700 px-4"
                  >
                    <Text className="text-white">Unpin</Text>
                  </Pressable>
                )}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityActions={canWrite ? [{ name: "unpin", label: "Unpin message" }] : []}
                  onAccessibilityAction={(event) => {
                    if (canWrite && event.nativeEvent.actionName === "unpin") unpin();
                  }}
                  onPress={() =>
                    navigation.dispatch(
                      StackActions.replace("BotAgentThread", {
                        ...scope,
                        taskId: pin.taskId,
                        title: pin.threadTitle ?? scope.name,
                        initialMessageId: pin.messageId,
                      }),
                    )
                  }
                  className="gap-1 bg-background px-4 py-3"
                >
                  <Text className="font-semibold">{author}</Text>
                  <Text numberOfLines={3}>{pin.text || "Attachment"}</Text>
                  <View className="flex-row gap-2">
                    {[pin.threadTitle ?? "Chat", pinnedBy ? `Pinned by ${pinnedBy}` : null]
                      .filter(Boolean)
                      .map((value) => (
                        <Text key={value} textRole="footnote" className="text-foreground-muted">
                          {value}
                        </Text>
                      ))}
                  </View>
                </Pressable>
              </ReanimatedSwipeable>
            );
          })}
        </SettingsSection>
      ) : rows ? (
        <Text className="p-4 text-center text-foreground-muted">No pinned messages</Text>
      ) : (
        <>
          <Text className="p-4 text-center text-foreground-muted">
            {loading ? "Loading pinned messages…" : "Pinned messages are unavailable."}
          </Text>
          {online && !loading && <ListActionRow label="Try again" onPress={retry} />}
        </>
      )}
    </ScreenScrollView>
  );
}
