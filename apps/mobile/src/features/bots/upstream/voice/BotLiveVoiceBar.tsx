import { Pressable, View } from "react-native";
import { useBotPalette } from "../BotChrome";
import { OpenBotText as Text } from "../OpenBotTypography";
import type { useBotLiveVoice } from "./useBotLiveVoice";

export function BotLiveVoiceBar({
  live,
  name,
}: {
  live: ReturnType<typeof useBotLiveVoice>;
  name: string;
}) {
  const p = useBotPalette();
  if (!live.state) return null;
  return (
    <View style={{ gap: 8, padding: 12, backgroundColor: p.surface, borderRadius: 24 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: p.text, fontSize: 15 }}>
        {live.state.phase === "error"
          ? "Voice conversation"
          : `${name} · ${
              {
                starting: "Starting",
                listening: "Listening",
                transcribing: "Transcribing",
                sending: "Sending",
                thinking: "Thinking",
                speaking: "Speaking",
                muted: "Muted",
              }[live.state.phase]
            }`}
      </Text>
      {!!live.state.caption && (
        <Text numberOfLines={2} style={{ color: p.muted, fontSize: 14 }}>
          {live.state.caption}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Pressable accessibilityRole="button" onPress={live.end} hitSlop={12}>
          <Text style={{ color: p.text, padding: 6 }}>End</Text>
        </Pressable>
        {live.state.retry && (
          <Pressable accessibilityRole="button" onPress={live.retry} hitSlop={12}>
            <Text style={{ color: p.text, padding: 6 }}>Retry</Text>
          </Pressable>
        )}
        {(live.state.phase === "listening" || live.state.phase === "muted") && (
          <Pressable accessibilityRole="button" onPress={live.mute} hitSlop={12}>
            <Text style={{ color: p.text, padding: 6 }}>
              {live.state.phase === "muted" ? "Unmute" : "Mute"}
            </Text>
          </Pressable>
        )}
        {(live.state.phase === "thinking" || live.state.phase === "speaking") && (
          <Pressable accessibilityRole="button" onPress={() => void live.interrupt()} hitSlop={12}>
            <Text style={{ color: p.text, padding: 6 }}>Interrupt</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
