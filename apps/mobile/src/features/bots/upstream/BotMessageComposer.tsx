import { useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { createComposerSendGate } from "./openbot-mobile/features/chat/model/composer-send";
import { restingComposerHeight } from "./openbot-mobile/shared/lib/composer-metrics";
import { useOpenBotFont } from "./OpenBotTypography";
import { TextInput, View, useWindowDimensions, type TextInputInstance } from "react-native";
import { useBotMotion } from "../botFeedback";
import { BotGlass, BotIconButton, useBotPalette } from "./BotChrome";

const AnimatedComposerField = Animated.createAnimatedComponent(TextInput);

/** Preserve the chat viewport above the native keyboard, including interactive dismissal. */
export function useBotKeyboardAvoidance(composerBottomPadding: number) {
  const { height } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -height.get() - composerBottomPadding + 8),
  }));
}

export function BotScrollToLatest({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ position: "absolute", top: -46, alignSelf: "center", zIndex: 3 }}>
      <BotGlass>
        <BotIconButton label="Scroll to latest" icon="arrow.down" onPress={onPress} />
      </BotGlass>
    </View>
  );
}

/** Shared native input and send control for bot conversations and group chats. */
export function BotMessageComposer({
  label,
  text,
  onChangeText,
  editable,
  action,
  actionDisabled,
  onAction,
  showVoiceControl,
  onDictate,
  voiceLabel,
  sendLabel = "Send message",
}: {
  label: string;
  text: string;
  onChangeText: (text: string) => void;
  editable: boolean;
  action: "send" | "stop";
  actionDisabled: boolean;
  onAction: (committedText: string) => void | Promise<void>;
  showVoiceControl: boolean;
  onDictate?: (() => void) | undefined;
  voiceLabel?: string | undefined;
  sendLabel?: string;
}) {
  const p = useBotPalette();
  const navigation = useNavigation();
  const { fontScale } = useWindowDimensions();
  const fontFamily = useOpenBotFont();
  const restingHeight = restingComposerHeight(fontScale);
  const compact = useBotMotion("compactComposer");
  const { height: keyboard } = useReanimatedKeyboardAnimation();
  const expandedHeight = Math.max(restingHeight, 52);
  const fieldHeight = useAnimatedStyle(() => {
    const opened = Math.min(1, Math.abs(keyboard.get()) / 260);
    return {
      minHeight: compact
        ? restingHeight + opened * (expandedHeight - restingHeight)
        : expandedHeight,
    };
  });
  const input = useRef<TextInputInstance>(null);
  const [gate] = useState(createComposerSendGate);
  const openVoiceSettings = () => navigation.navigate("SettingsBotVoice");
  const submit = async (committedText: string) => {
    await (async () => {
      await onAction(committedText);
    })().finally(() => {
      gate.allowRetry();
    });
  };
  return (
    <BotGlass
      style={{ flex: 1, borderRadius: 28, paddingLeft: 16, paddingRight: 4, paddingVertical: 4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
        <AnimatedComposerField
          ref={input}
          accessibilityLabel={label}
          placeholder="Message…"
          placeholderTextColor={p.muted}
          multiline
          maxLength={100_000}
          editable={editable}
          value={text}
          onFocus={gate.focus}
          onChangeText={(value) => {
            gate.edit();
            onChangeText(value);
          }}
          onEndEditing={({ nativeEvent }) => {
            if (gate.commit() && !actionDisabled) void submit(nativeEvent.text);
          }}
          style={[
            {
              flex: 1,
              maxHeight: 132,
              paddingTop: 12,
              paddingBottom: 10,
              fontFamily,
              fontSize: 16,
              lineHeight: 22,
              color: p.text,
            },
            fieldHeight,
          ]}
        />
        {showVoiceControl && action === "send" && actionDisabled && !text.trim() ? (
          <BotIconButton
            label={voiceLabel ?? (onDictate ? "Dictate message" : "Voice settings")}
            icon="mic"
            onPress={onDictate ?? openVoiceSettings}
            onLongPress={onDictate ? openVoiceSettings : undefined}
          />
        ) : (
          <BotIconButton
            label={action === "stop" ? "Stop turn" : sendLabel}
            icon={action === "stop" ? "stop.fill" : "arrow.up"}
            filled={!actionDisabled}
            disabled={actionDisabled}
            onPress={() => {
              if (action === "stop") {
                gate.cancel();
                void onAction(text);
                return;
              }
              const request = gate.request();
              if (request === "blur") input.current?.blur();
              if (request === "send") void submit(text);
            }}
          />
        )}
      </View>
    </BotGlass>
  );
}
