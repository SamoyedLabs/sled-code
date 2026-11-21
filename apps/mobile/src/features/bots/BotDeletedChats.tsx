import type { EnvironmentId } from "@t3tools/contracts";
import { randomUUID } from "expo-crypto";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useBotChannels } from "../settings/useBotChannels";
import { GroupAvatar } from "./upstream/GroupAvatar";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { T, useGT } from "gt-react-native";

export function BotDeletedChats({
  environmentId,
  hostId,
  onClose,
  onOpen,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onClose: () => void;
  onOpen: (channelId: string, name: string) => void;
}) {
  const gt = useGT();
  const channel = useBotChannels(environmentId, hostId, randomUUID);
  const agents = useMemo(
    () => new Map(channel.agents.map((agent) => [agent.id, agent])),
    [channel.agents],
  );
  const deleted = channel.channels?.filter((entry) => entry.archived) ?? [];
  const p = useBotPalette();
  return (
    <Sheet title={gt("Deleted chats")} onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 py-5"
      >
        <Text style={{ color: p.muted }}>
          <T>You can preview or restore deleted group chats here.</T>
        </Text>
        {channel.error && (
          <Text accessibilityRole="alert" style={{ color: p.text }}>
            {String(channel.error)}
          </Text>
        )}
        {deleted.length === 0 ? (
          <Text style={{ color: p.muted }}>
            {channel.loading ? gt("Loading…") : gt("No deleted chats")}
          </Text>
        ) : (
          <View style={{ borderRadius: 22, overflow: "hidden", backgroundColor: p.control }}>
            {deleted.map((entry) => (
              <View
                key={entry.id}
                style={{
                  flexDirection: "row",
                  minHeight: 72,
                  alignItems: "center",
                  paddingHorizontal: 12,
                  gap: 10,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("Preview {name}", { name: entry.name })}
                  onPress={() => onOpen(entry.id, entry.name)}
                  style={{
                    flex: 1,
                    minHeight: 58,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <GroupAvatar members={entry.members} agents={agents} size={42} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: p.text, fontSize: 15, fontWeight: "600" }}
                    >
                      {entry.name}
                    </Text>
                    <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13 }}>
                      {entry.lastMessage?.text ?? gt("No messages yet")}
                    </Text>
                  </View>
                </Pressable>
                {channel.canManage && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={gt("Restore {name}", { name: entry.name })}
                    disabled={channel.busy}
                    onPress={() =>
                      void channel.act({ operation: "channel.restore", channelId: entry.id })
                    }
                    style={{
                      minHeight: 44,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      borderRadius: 22,
                      paddingHorizontal: 10,
                      backgroundColor: p.surface,
                    }}
                  >
                    <SymbolView name="arrow.clockwise" size={15} tintColor={p.text} />
                    <Text style={{ color: p.text, fontSize: 13 }}>
                      <T>Restore</T>
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </ScreenScrollView>
    </Sheet>
  );
}
