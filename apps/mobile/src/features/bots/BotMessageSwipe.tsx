import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, I18nManager, Platform, View, type ViewProps } from "react-native";
import { selectionAsync } from "./botFeedback";
import { GestureDetector, useCompetingGestures, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SymbolView } from "../../components/ui/AppSymbol";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { useBotPalette } from "./upstream/BotChrome";
import { isCommittedRightSwipe } from "./bots-edge-gesture";

export type BotForwardGesture = ReturnType<typeof usePanGesture>;
const end = I18nManager.isRTL ? -1 : 1;
const timeWidth = 70;
const settle = { duration: 260, dampingRatio: 0.9, reduceMotion: ReduceMotion.System };
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function useBotMessageActionButtons() {
  const [screenReader, setScreenReader] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Mirror the iOS accessibility setting for the VoiceOver alternative to a message long press.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let cancelled = false;
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (value) => {
        if (!cancelled) setScreenReader(value);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return Platform.OS !== "ios" || screenReader;
}

function resist(distance: number, limit: number) {
  "worklet";
  return Math.max(0, Math.min(distance, limit) + Math.max(0, distance - limit) * 0.14);
}

export function BotMessageSwipe({
  children,
  actions,
  timeOffset,
  createdAt,
  own,
  forwardGesture,
  onReply,
  onLayout,
}: {
  children: ReactNode;
  actions?: ReactNode;
  timeOffset: SharedValue<number>;
  createdAt: string;
  own: boolean;
  forwardGesture?: BotForwardGesture;
  onReply?: () => void;
  onLayout?: ViewProps["onLayout"];
}) {
  const palette = useBotPalette();
  const replyOffset = useSharedValue(0);
  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: (replyOffset.get() - timeOffset.get()) * end }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, replyOffset.get() / 64) }));
  const timeStyle = useAnimatedStyle(() => ({ opacity: Math.min(timeOffset.get() / 48, 1) }));
  const reply = () => {
    void selectionAsync().catch(() => undefined);
    onReply?.();
  };
  const replyPan = usePanGesture({
    enabled: Boolean(onReply),
    activeOffsetX: 16 * end,
    failOffsetX: -8 * end,
    failOffsetY: [-12, 12],
    block: forwardGesture,
    onUpdate(event) {
      "worklet";
      replyOffset.set(resist(event.translationX * end, 64));
    },
    onDeactivate(event) {
      "worklet";
      if (
        !event.canceled &&
        isCommittedRightSwipe(event.translationX * end, event.translationY, event.velocityX * end)
      )
        scheduleOnRN(reply);
    },
    onFinalize() {
      "worklet";
      replyOffset.set(withSpring(0, settle));
    },
  });
  const timePan = usePanGesture({
    activeOffsetX: -16 * end,
    failOffsetX: 8 * end,
    failOffsetY: [-12, 12],
    block: forwardGesture,
    onUpdate(event) {
      "worklet";
      timeOffset.set(resist(-event.translationX * end, timeWidth));
    },
    onFinalize() {
      "worklet";
      timeOffset.set(withSpring(0, settle));
    },
  });
  const gesture = useCompetingGestures(replyPan, timePan);
  const time = Date.parse(createdAt);
  return (
    <View onLayout={onLayout}>
      {Number.isFinite(time) && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: "absolute",
              end: 0,
              top: 0,
              bottom: 0,
              width: timeWidth,
              alignItems: "flex-end",
              justifyContent: "center",
            },
            timeStyle,
          ]}
        >
          <Text style={{ color: palette.muted, fontSize: 12 }}>{clock.format(time)}</Text>
        </Animated.View>
      )}
      {onReply && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", start: 0, top: 0, bottom: 0, justifyContent: "center" },
            iconStyle,
          ]}
        >
          <SymbolView name="arrow.uturn.backward" size={18} tintColor={palette.muted} />
        </Animated.View>
      )}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[{ alignSelf: own ? "flex-end" : "flex-start", maxWidth: "94%" }, moved]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
      {actions && (
        <View style={{ alignSelf: own ? "flex-end" : "flex-start" }}>{actions}</View>
      )}
    </View>
  );
}
