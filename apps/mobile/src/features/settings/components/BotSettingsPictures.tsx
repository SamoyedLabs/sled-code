// Adapted from OpenBot iOS 1.4.11, a09baff9b760ed761a4e3eb0dc9d441db5b009cf.
import { useEffect, useRef } from "react";
import { I18nManager, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useBotReducedMotion } from "../../bots/botFeedback";

const END_X = I18nManager.isRTL ? -1 : 1;

const SLIDE = Easing.bezier(0.32, 0.72, 0, 1);
const OUT = Easing.out(Easing.cubic);
const IN_OUT = Easing.inOut(Easing.quad);
/** A line types out from the start of the reading direction: the left, or the right in RTL. */
const LINE_START_ORIGIN = END_X === 1 ? "0% 50%" : "100% 50%";

/**
 * Runs `run` once for each new tap: when `play` grows. A change of reduced motion or of a prop does
 * not play the demonstration again. With reduced motion, the picture stays still.
 */
function useDemonstration(play: number, run: () => void) {
  const reduced = useBotReducedMotion();
  const played = useRef(play);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Start the native animation for this tap after the selected preference has committed.
  useEffect(() => {
    // `play` goes back to 0 when another option is tapped. Only a larger value is a new tap.
    const grew = play > played.current;
    played.current = play;
    if (grew && !reduced) run();
  });
}

/** A line of text or a bar in a picture. `strong` is a darker line, such as your own message. */
function Bar({ className, strong = false }: { className: string; strong?: boolean }) {
  return (
    <View
      className={`rounded-full bg-foreground-muted ${className}`}
      style={{ opacity: strong ? 0.55 : 0.28 }}
    />
  );
}

/** An agent face: the shape of an avatar with two eyes. */
function Face({
  className,
  eyeStyle,
}: {
  className: string;
  eyeStyle?: ReturnType<typeof useAnimatedStyle>;
}) {
  return (
    <View className={`items-center justify-center rounded-[7px] ${className}`}>
      <View
        className="absolute inset-0 rounded-[7px] bg-foreground-muted"
        style={{ opacity: 0.55 }}
      />
      <View className="flex-row gap-[5px]">
        <Animated.View className="h-[5px] w-[3px] rounded-full bg-grouped-card" style={eyeStyle} />
        <Animated.View className="h-[5px] w-[3px] rounded-full bg-grouped-card" style={eyeStyle} />
      </View>
    </View>
  );
}

/** Settings > Animations: an agent face and a reply. With full motion, the face moves and the reply types out. */
export function MotionPicture({ full, play }: { full: boolean; play: number }) {
  const lift = useSharedValue(0);
  const blink = useSharedValue(1);
  const line0 = useSharedValue(1);
  const line1 = useSharedValue(1);
  const line2 = useSharedValue(1);
  useDemonstration(play, () => {
    if (!full) return;
    const bob = { duration: 260, easing: IN_OUT };
    lift.set(
      withSequence(
        withTiming(-3, bob),
        withTiming(0, bob),
        withTiming(-3, bob),
        withTiming(0, bob),
      ),
    );
    blink.set(
      withDelay(
        520,
        withSequence(withTiming(0.1, { duration: 80 }), withTiming(1, { duration: 120 })),
      ),
    );
    [line0, line1, line2].forEach((line, index) => {
      line.set(0);
      line.set(withDelay(120 + index * 160, withTiming(1, { duration: 380, easing: OUT })));
    });
  });
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.get() }] }));
  const lineStyles = [
    useAnimatedStyle(() => ({ transform: [{ scaleX: line0.get() }] })),
    useAnimatedStyle(() => ({ transform: [{ scaleX: line1.get() }] })),
    useAnimatedStyle(() => ({ transform: [{ scaleX: line2.get() }] })),
  ];
  return (
    <View className="flex-1">
      {full ? (
        <>
          <View className="absolute bottom-[40px] left-[7px] size-3 rounded-full border-t-[1.5px] border-l-[1.5px] border-foreground-muted" />
          <View
            className="absolute bottom-[44px] left-[3px] size-5 rounded-full border-t-[1.5px] border-l-[1.5px] border-foreground-muted"
            style={{ opacity: 0.5 }}
          />
        </>
      ) : null}
      <Animated.View className="absolute bottom-3.5 left-3" style={faceStyle}>
        <Face className="size-[22px]" eyeStyle={eyeStyle} />
      </Animated.View>
      <View className="absolute right-3 bottom-3.5 left-[42px] gap-[5px]">
        {(["w-[92%]", "w-[74%]", "w-[46%]"] as const).map((width, index) => (
          <Animated.View
            key={width}
            className={`h-1.5 rounded-full bg-foreground-muted/30 ${width}`}
            style={[{ transformOrigin: LINE_START_ORIGIN }, lineStyles[index]]}
          />
        ))}
      </View>
    </View>
  );
}

/** The height of the keyboard in a message field picture. */
const KEYBOARD_HEIGHT = 36;

/**
 * Settings > Conversations > Message field. The demonstration opens and closes the keyboard; a
 * compact field grows into the full field while the keyboard is open.
 */
export function ComposerPicture({ compact, play }: { compact: boolean; play: number }) {
  const open = useSharedValue(0);
  const small = useSharedValue(1);
  useDemonstration(play, () => {
    const slide = { duration: 300, easing: SLIDE };
    open.set(withSequence(withTiming(1, slide), withDelay(700, withTiming(0, slide))));
    if (compact)
      small.set(
        withSequence(
          withTiming(0, { duration: 160 }),
          withDelay(840, withTiming(1, { duration: 200 })),
        ),
      );
  });
  const keyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - open.get()) * KEYBOARD_HEIGHT }],
  }));
  const fieldStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -open.get() * KEYBOARD_HEIGHT }],
  }));
  const smallStyle = useAnimatedStyle(() => ({ opacity: small.get() }));
  const wideStyle = useAnimatedStyle(() => ({ opacity: 1 - small.get() }));
  return (
    <View className="flex-1">
      <Bar className="absolute top-3 left-2.5 h-3 w-1/2" />
      <Animated.View className="absolute right-2.5 bottom-2.5 left-2.5 h-3.5" style={fieldStyle}>
        {compact ? (
          <>
            <Animated.View className="absolute inset-y-0 left-[26%] w-[48%]" style={smallStyle}>
              <Bar strong className="h-3.5 w-full" />
            </Animated.View>
            <Animated.View className="absolute inset-0" style={wideStyle}>
              <Bar strong className="h-3.5 w-full" />
            </Animated.View>
          </>
        ) : (
          <Bar strong className="h-3.5 w-full" />
        )}
      </Animated.View>
      <Animated.View
        className="absolute inset-x-0 bottom-0 gap-1 border-border border-t bg-background p-1.5"
        style={[{ height: KEYBOARD_HEIGHT }, keyboardStyle]}
      >
        <Bar className="h-[5px] w-full" />
        <Bar className="mx-2 h-[5px]" />
        <Bar className="mx-5 h-[5px]" />
      </Animated.View>
    </View>
  );
}

/** The part of the picture that the chat moves aside for the panel. */
const PANEL_SHARE = 0.54;

/** With "off", the chat moves a little with the swipe and comes back: no screen opens. */
const OFF_NUDGE = 0.08;

/**
 * Settings > Conversations > swipe in an agent chat. The picture shows the panel open beside the
 * chat; the demonstration closes it and opens it again, as a swipe does. "Off" shows only the chat.
 */
export function SwipePicture({
  target,
  play,
}: {
  target: "threads" | "browser" | "off";
  play: number;
}) {
  const width = useSharedValue(0);
  const shown = useSharedValue(1);
  useDemonstration(play, () => {
    const slide = { duration: 320, easing: SLIDE };
    shown.set(
      target === "off"
        ? withSequence(
            withTiming(0, { duration: 220, easing: OUT }),
            withTiming(1, { duration: 360, easing: SLIDE }),
          )
        : withSequence(withTiming(0, slide), withDelay(600, withTiming(1, slide))),
    );
  });
  // React Native mirrors the layout in RTL (the panel opens from the left), but not translateX.
  const chatStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          target === "off"
            ? -END_X * (1 - shown.get()) * width.get() * OFF_NUDGE
            : -END_X * shown.get() * width.get() * (PANEL_SHARE - 0.08),
      },
    ],
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: END_X * (1 - shown.get()) * width.get() * PANEL_SHARE }],
  }));
  return (
    <View
      className="flex-1"
      onLayout={(event) => {
        width.set(event.nativeEvent.layout.width);
      }}
    >
      <Animated.View className="absolute inset-0 gap-1.5 px-2.5 py-3" style={chatStyle}>
        <Bar className="h-[7px] w-[70%]" />
        <Bar strong className="h-[7px] w-1/2 self-end" />
        <Bar className="h-[7px] w-[70%]" />
      </Animated.View>
      {target === "off" ? null : (
        <Animated.View
          className="absolute inset-y-0 right-0 gap-1.5 border-border border-l bg-background px-2 py-2.5"
          style={[{ width: `${PANEL_SHARE * 100}%` }, panelStyle]}
        >
          {target === "threads" ? (
            <>
              <Bar strong className="h-[7px] w-[55%]" />
              <Bar className="h-1.5 w-full" />
              <Bar className="h-1.5 w-[60%]" />
              <Bar className="h-1.5 w-full" />
            </>
          ) : (
            <>
              <Bar className="h-3 w-full" />
              <View className="h-[38px] w-full rounded-md bg-foreground-muted/25" />
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}
