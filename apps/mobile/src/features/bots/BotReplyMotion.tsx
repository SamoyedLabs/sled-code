import { useEffect, useEffectEvent, useState, type ComponentProps } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { botSemanticMarkdown } from "./botSemanticMarkdown";
import { botReplyParts } from "./bot-reply-previews";
import { BotCodePreview } from "./BotCodePreview";
import { botReplyTick, useBotMotion, useBotReducedMotion } from "./botFeedback";
import { useBotPalette } from "./upstream/BotChrome";
import { startReplyPlayback } from "./upstream/openbot-mobile/chat-preview/reply-playback";

export function BotReplyMarkdown({
  body,
  streaming,
  visualPreviews = false,
  selectable = false,
  ...props
}: Omit<ComponentProps<typeof SelectableMarkdownText>, "markdown"> & {
  body: string;
  streaming: boolean;
  visualPreviews?: boolean;
}) {
  const canReveal = useBotMotion("textReveal");
  const [prefix, setPrefix] = useState("");
  const [playing, setPlaying] = useState(streaming && canReveal);
  const [wasStreaming, setWasStreaming] = useState(streaming);
  if (streaming !== wasStreaming) {
    setWasStreaming(streaming);
    if (streaming && canReveal) {
      setPrefix("");
      setPlaying(true);
    }
  }
  if (playing && !canReveal) setPlaying(false);
  const reveal = playing && canReveal;
  const readFrame = useEffectEvent(() => ({ body, streaming }));
  const publishFrame = useEffectEvent((next: string, word?: string, index?: number) => {
    setPrefix(next);
    if (word && index !== undefined && visualPreviews) botReplyTick(word, index);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own one cancellable playback timer per live reply across incoming host updates.
  useEffect(() => {
    if (!reveal) return;
    return startReplyPlayback({
      read: () => readFrame(),
      publish: (next, word, index) => publishFrame(next, word, index),
      complete: () => setPlaying(false),
    });
  }, [reveal]);

  const parts = botReplyParts(reveal && body.startsWith(prefix) ? prefix : body, visualPreviews);
  const renderPart = (part: (typeof parts)[number]) =>
    part.type === "preview" ? (
      <BotCodePreview key={part.start} preview={part} streaming={streaming} />
    ) : (
      <SelectableMarkdownText
        key={part.start}
        {...props}
        selectable={selectable}
        markdown={botSemanticMarkdown(part.body)}
      />
    );
  return parts.length === 1 ? (
    renderPart(parts[0]!)
  ) : (
    <View style={{ gap: 8 }}>{parts.map(renderPart)}</View>
  );
}

function TypingDot({
  phase,
  offset,
  color,
}: {
  phase: SharedValue<number>;
  offset: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const time = (phase.get() + 1 - offset) % 1;
    const strength = interpolate(time, [0, 0.16, 0.34, 1], [0, 1, 0, 0]);
    return { opacity: 0.42 + strength * 0.58, transform: [{ translateY: -2 * strength }] };
  });
  return (
    <Animated.View
      style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]}
    />
  );
}

export function BotTypingBubble() {
  const palette = useBotPalette();
  const reduced = useBotReducedMotion();
  const phase = useSharedValue(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The UI-thread animation exists only while the bot is waiting to write.
  useEffect(() => {
    if (!reduced)
      phase.set(withRepeat(withTiming(1, { duration: 1_150, easing: Easing.linear }), -1));
    return () => cancelAnimation(phase);
  }, [phase, reduced]);
  return (
    <View
      accessible
      accessibilityLabel="Bot is typing"
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        width: 56,
        height: 34,
        borderRadius: 17,
        borderCurve: "continuous",
        backgroundColor: palette.surface,
      }}
    >
      <TypingDot phase={phase} offset={0} color={palette.muted} />
      <TypingDot phase={phase} offset={0.12} color={palette.muted} />
      <TypingDot phase={phase} offset={0.24} color={palette.muted} />
    </View>
  );
}
