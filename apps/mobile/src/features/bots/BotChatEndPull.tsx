import { type ReactNode } from "react";
import { Platform } from "react-native";
import { impactAsync, ImpactFeedbackStyle, selectionAsync } from "./botFeedback";
import Animated, {
  ReduceMotion,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useBotPalette } from "./upstream/BotChrome";

const diameter = 44;
const ios = Platform.OS === "ios";
const radius = 20.5;
const circumference = 2 * Math.PI * radius;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function feedback(step: number) {
  const request = step === 12 ? impactAsync(ImpactFeedbackStyle.Heavy) : selectionAsync();
  void request.catch(() => undefined);
}

export function useBotChatEndPull({
  enabled,
  onOpen,
  onNearLatest,
  onViewport,
}: {
  enabled: boolean;
  onOpen: () => void;
  onNearLatest: (near: boolean, userScroll: boolean) => void;
  onViewport?: ((top: number, height: number) => void) | undefined;
}) {
  const progress = useSharedValue(0);
  const armed = useSharedValue(false);
  const dragging = useSharedValue(false);
  const momentum = useSharedValue(false);
  const nearLatest = useSharedValue<boolean | null>(null);
  const viewport = useSharedValue({ bucket: -1, height: 0 });

  // OpenBot chat-end-pull.tsx starts the iOS ring after 28 points of bounce.
  // The next 48 points fill it. A small reversal before lift preserves the full pull.
  const onScroll = useAnimatedScrollHandler({
    onBeginDrag() {
      dragging.set(true);
      armed.set(false);
      progress.set(0);
      nearLatest.set(null);
    },
    onScroll(event) {
      if (onViewport) {
        const top = Math.max(0, event.contentOffset.y);
        const height = event.layoutMeasurement.height;
        const bucket = Math.floor(top / 44);
        const prior = viewport.get();
        if (prior.bucket !== bucket || prior.height !== height) {
          viewport.set({ bucket, height });
          scheduleOnRN(onViewport, top, height);
        }
      }
      const end = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
      const beyond = event.contentOffset.y - end;
      const near = beyond > -80;
      if (nearLatest.get() !== near) {
        nearLatest.set(near);
        scheduleOnRN(onNearLatest, near, dragging.get() || momentum.get());
      }
      if (!enabled || !ios || !dragging.get()) return;
      const value = Math.max(0, Math.min(1, (beyond - 28) / 48));
      const oldStep = Math.floor(progress.get() * 12);
      const step = Math.floor(value * 12);
      const wasArmed = armed.get();
      const isArmed = step >= 12 || (wasArmed && value >= 0.8);
      if (isArmed && !wasArmed) scheduleOnRN(feedback, 12);
      else if (step > oldStep && step < 12) scheduleOnRN(feedback, step);
      progress.set(value);
      armed.set(isArmed);
    },
    onEndDrag(event) {
      dragging.set(false);
      if (onViewport)
        scheduleOnRN(
          onViewport,
          Math.max(0, event.contentOffset.y),
          event.layoutMeasurement.height,
        );
      const opening = enabled && armed.get();
      armed.set(false);
      progress.set(
        opening ? 0 : withTiming(0, { duration: 200, reduceMotion: ReduceMotion.System }),
      );
      if (opening) scheduleOnRN(onOpen);
    },
    onMomentumBegin() {
      momentum.set(true);
    },
    onMomentumEnd(event) {
      momentum.set(false);
      if (onViewport)
        scheduleOnRN(
          onViewport,
          Math.max(0, event.contentOffset.y),
          event.layoutMeasurement.height,
        );
    },
  });

  return { onScroll, progress };
}

export function BotChatEndPullRing({
  progress,
  children,
}: {
  progress: SharedValue<number>;
  children: ReactNode;
}) {
  const palette = useBotPalette();
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(progress.get() * 7, 1),
    transform: [{ translateY: (1 - progress.get()) * 8 }],
  }));
  const ring = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.get()),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: "absolute",
          bottom: "100%",
          alignSelf: "center",
          marginBottom: 5,
          height: diameter,
          width: diameter,
          borderRadius: diameter / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surface,
        },
        style,
      ]}
    >
      <Svg width={diameter} height={diameter} style={{ position: "absolute" }}>
        <Circle cx={22} cy={22} r={radius} fill="none" stroke={palette.border} strokeWidth={3} />
        <AnimatedCircle
          cx={22}
          cy={22}
          r={radius}
          fill="none"
          stroke={palette.action}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={[circumference, circumference]}
          transform="rotate(-90 22 22)"
          animatedProps={ring}
        />
      </Svg>
      {children}
    </Animated.View>
  );
}
