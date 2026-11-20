import { View } from "react-native";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { type BotRosterWait } from "./bot-roster-state";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { typeScale } from "./upstream/openbot-mobile/shared/lib/type-scale";

// OpenBot 1.4.11 agent-wait-badge and agent-unread-badge presentation.
const waitStyle = {
  prompt: { action: "Answer", state: "Waiting for your answer", icon: "questionmark.bubble" },
  approval: { action: "Review", state: "Waiting for your approval", icon: "exclamationmark.shield" },
  takeover: { action: "Take over", state: "Waiting for you in the browser", icon: "safari" },
} satisfies Record<BotRosterWait, { action: string; state: string; icon: AppSymbolName }>;

export function botRosterStatusLabel(wait: BotRosterWait | undefined, unread: number) {
  if (wait) return waitStyle[wait].state;
  return unread > 0 ? `${unread} unread` : "";
}

export function BotRosterAvatarBadge({
  wait,
  unread,
  avatarSize,
}: {
  wait: BotRosterWait | undefined;
  unread: number;
  avatarSize: number;
}) {
  const p = useBotPalette();
  if (wait)
    return (
      <View
        pointerEvents="none"
        className="absolute items-center justify-center rounded-full"
        style={{
          right: -3,
          bottom: -3,
          width: 20,
          height: 20,
          borderWidth: 2,
          borderColor: p.canvas,
          backgroundColor: p.warning,
        }}
      >
        <SymbolView name={waitStyle[wait].icon} size={12} tintColor={p.canvas} />
      </View>
    );
  if (unread <= 0) return null;
  const felt = Math.round((avatarSize * 16) / 46);
  const ring = Math.round((avatarSize * 3.5) / 46);
  return (
    <View
      pointerEvents="none"
      className="absolute items-center justify-center rounded-full"
      style={{
        right: -Math.round((avatarSize * 3) / 46) - ring,
        bottom: -Math.round(avatarSize / 46) - ring,
        minWidth: felt + ring * 2,
        height: felt + ring * 2,
        paddingHorizontal: Math.round(felt * 0.2),
        borderWidth: ring,
        borderColor: p.canvas,
        backgroundColor: "#4a285c",
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: "#f6efe2",
          fontSize: Math.round((avatarSize * 14) / 46),
          lineHeight: felt,
          fontWeight: "700",
        }}
      >
        {Math.min(unread, 99).toLocaleString()}
      </Text>
    </View>
  );
}

export function BotRosterWaitChip({ wait }: { wait: BotRosterWait }) {
  const p = useBotPalette();
  return (
    <View
      className="flex-row items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5"
      style={{ backgroundColor: p.warningSoft }}
    >
      <SymbolView name={waitStyle[wait].icon} size={13} tintColor={p.warningText} />
      <Text numberOfLines={1} style={{ ...typeScale.small, color: p.warningText, fontWeight: "700" }}>
        {waitStyle[wait].action}
      </Text>
    </View>
  );
}
