import { Platform } from "react-native";
import { BotGroupChat } from "./BotGroupChat";
import { OpenbotNotificationTarget } from "@t3tools/contracts";
import { botNotificationDeepLink } from "@t3tools/shared/agentAwareness";
import type { StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { BotChatWorkspace, BotDetail } from "./BotsRouteScreen";
import { BotChannels } from "../settings/BotChannels";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
const decodeTarget = Schema.decodeUnknownOption(OpenbotNotificationTarget);
type Params = {
  environmentId: string;
  hostId: string;
  agentId: string;
  taskId?: string;
  channelId?: string;
  routineId?: string;
  routineRunId?: string;
};
export function BotNotificationRouteScreen({ route }: StaticScreenProps<Params>) {
  const decoded = decodeTarget({
    kind: "bot",
    ...route.params,
  });
  if (Option.isNone(decoded) || botNotificationDeepLink(decoded.value) === null)
    return (
      <SettingsScreen title="Bot notification">
        <Text accessibilityRole="alert">This notification target is invalid.</Text>
      </SettingsScreen>
    );
  return <Destination key={botNotificationDeepLink(decoded.value)} target={decoded.value} />;
}
function Destination({ target }: { target: OpenbotNotificationTarget }) {
  const host = useEnvironmentQuery(
    openbot.status({ environmentId: target.environmentId, input: {} }),
  );
  const agents = useEnvironmentQuery(
    host.data?.state === "ready" && host.data.hostId === target.hostId
      ? openbot.agents({ environmentId: target.environmentId, input: {} })
      : null,
  );
  const agent = agents.data?.find((item) => item.id === target.agentId);
  if (host.data?.state !== "ready" || host.data.hostId !== target.hostId || !agent)
    return (
      <SettingsScreen title="Bot notification">
        <Text accessibilityRole="status">
          {host.isPending || agents.isPending
            ? "Connecting to the notification’s bot…"
            : host.error ||
              agents.error ||
              "This bot or host is unavailable. Reconnect its environment to review the notification."}
        </Text>
      </SettingsScreen>
    );
  if (target.channelId && target.taskId === undefined && Platform.OS === "ios")
    return (
      <BotGroupChat
        environmentId={target.environmentId}
        hostId={target.hostId}
        channelId={target.channelId}
      />
    );
  if (target.channelId)
    return (
      <SettingsScreen title={agent.name}>
        <ScreenScrollView contentContainerClassName="gap-3 px-5 py-4">
          <BotChannels
            environmentId={target.environmentId}
            hostId={target.hostId}
            initialChannelId={target.channelId}
            {...(target.taskId === undefined ? {} : { initialTaskId: target.taskId })}
          />
        </ScreenScrollView>
      </SettingsScreen>
    );
  if (Platform.OS === "ios" && target.taskId === undefined && target.routineId === undefined)
    return (
      <BotChatWorkspace
        selection={{
          environmentId: target.environmentId,
          hostId: target.hostId,
          agentId: agent.id,
          name: agent.name,
          ...(agent.avatarSeed ? { avatarSeed: agent.avatarSeed } : {}),
          avatarHue: agent.avatarHue ?? null,
        }}
      />
    );
  return (
    <BotDetail
      environmentId={target.environmentId}
      hostId={target.hostId}
      agentId={target.agentId}
      name={agent.name}
      {...(target.taskId === undefined ? {} : { initialTaskId: target.taskId })}
      {...(target.routineId === undefined ? {} : { initialRoutineId: target.routineId })}
      {...(target.routineRunId === undefined ? {} : { initialRoutineRunId: target.routineRunId })}
    />
  );
}
