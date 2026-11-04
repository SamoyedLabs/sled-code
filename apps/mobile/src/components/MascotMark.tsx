import type { MascotActivity } from "@t3tools/client-runtime/state/mascot-activity";
import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import geometry from "../../../../assets/branding/mascot/geometry.json";
import { useAppActive, useReduceMotionEnabled } from "../lib/appState";
import { darkMascot } from "../lib/mascotBranding";
import { AppText } from "./ui/AppText";
import { useControlTheme } from "./ui/useControlTheme";

const LEFT_EAR = darkMascot
  ? require("../../../../assets/branding/mascot-dev/ear-left.png")
  : require("../../../../assets/branding/mascot/ear-left.png");
const RIGHT_EAR = darkMascot
  ? require("../../../../assets/branding/mascot-dev/ear-right.png")
  : require("../../../../assets/branding/mascot/ear-right.png");
const CLOSED_MOUTH = darkMascot
  ? require("../../../../assets/branding/mascot-dev/closed-mouth.png")
  : require("../../../../assets/branding/mascot/closed-mouth.png");
const PANT = darkMascot
  ? require("../../../../assets/branding/mascot-dev/pant-mouth.png")
  : require("../../../../assets/branding/mascot/pant-mouth.png");
const SPEECH_BUBBLE = require("../../../../assets/branding/mascot/speech-bubble.png");
const FUR = darkMascot
  ? require("../../../../assets/branding/mascot-dev/fur.png")
  : require("../../../../assets/branding/mascot/fur.png");
const LEFT_EYE = darkMascot
  ? require("../../../../assets/branding/mascot-dev/eye-left.png")
  : require("../../../../assets/branding/mascot/eye-left.png");
const RIGHT_EYE = darkMascot
  ? require("../../../../assets/branding/mascot-dev/eye-right.png")
  : require("../../../../assets/branding/mascot/eye-right.png");
const CLOSED = darkMascot
  ? require("../../../../assets/branding/mascot-dev/closed.png")
  : require("../../../../assets/branding/mascot/closed.png");
const TONGUE = require("../../../../assets/branding/mascot/tongue.png");

export function MascotMark({
  activity,
  size,
  visible,
}: {
  activity: MascotActivity;
  size: number;
  visible: boolean;
}) {
  const foreground = useAppActive();
  const active = foreground && visible;
  const reduced = useReduceMotionEnabled();
  const clock = useSharedValue(0);
  const celebration = useSharedValue(1);
  const previousCompletion = useRef(activity.completionKey);
  const state = activity.state;
  const running = active && !reduced;
  const dogSize = size * 0.9375;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- start/stop the UI-thread animation clock with native visibility and accessibility preferences
  useEffect(() => {
    clock.set(0);
    if (
      active &&
      !reduced &&
      (state === "sleeping" || state === "working" || state === "attention")
    ) {
      clock.set(withRepeat(withTiming(9600, { duration: 9600, easing: Easing.linear }), -1, false));
    }
    return () => cancelAnimation(clock);
  }, [active, clock, reduced, state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an observed new completion triggers a single native animation, never a replay on mount or foreground
  useEffect(() => {
    const changed = previousCompletion.current !== activity.completionKey;
    previousCompletion.current = activity.completionKey;
    cancelAnimation(celebration);
    celebration.set(1);
    if (changed && activity.completionKey !== null && active && !reduced && state === "sleeping") {
      celebration.set(0);
      celebration.set(withTiming(1, { duration: 850, easing: Easing.linear }));
    }
    return () => cancelAnimation(celebration);
  }, [active, activity.completionKey, celebration, reduced, state]);

  const dogStyle = useAnimatedStyle(() => {
    const time = clock.get();
    const sleep = Math.sin((time / 3200) * Math.PI * 2);
    const eager = (1 - Math.cos((time / 1200) * Math.PI * 2)) / 2;
    const p = celebration.get();
    const hop =
      p < 0.15
        ? (p / 0.15) * 0.025
        : p < 0.45
          ? 0.025 - ((p - 0.15) / 0.3) * 0.12
          : p < 0.8
            ? -0.095 + ((p - 0.45) / 0.35) * 0.095
            : 0;
    return {
      opacity: state === "offline" ? 0.5 : 1,
      transform: [
        {
          translateY:
            dogSize *
            (hop +
              (state === "sleeping"
                ? 0.01 - sleep * 0.015
                : state === "attention"
                  ? -0.03 * eager
                  : 0)),
        },
        {
          rotate: `${state === "attention" ? -3 + eager * 6 : state === "working" ? Math.sin((time / 4800) * Math.PI * 2) * 1.5 : state === "error" ? -8 : state === "sleeping" ? 8 : 0}deg`,
        },
        { scaleY: state === "sleeping" ? 1 + sleep * 0.02 : 1 },
      ],
    };
  });
  const eyesStyle = useAnimatedStyle(() => {
    const phase = (clock.get() % 3000) / 3000;
    const blink = phase > 0.44 && phase < 0.52 ? Math.min(1, Math.abs(phase - 0.48) / 0.04) : 1;
    return {
      opacity: state === "sleeping" && celebration.get() === 1 ? 0 : 1,
      transform: [
        { translateX: state === "working" ? Math.sin(phase * Math.PI * 2) * dogSize * 0.016 : 0 },
        { scaleY: state === "error" ? 0.8 : blink },
      ],
    };
  });
  const leftEarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${state === "attention" ? -1 - Math.cos((clock.get() / 1200) * Math.PI * 2) * 13 : state === "sleeping" ? -9 : state === "error" ? -16 : 0}deg`,
      },
    ],
  }));
  const rightEarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${state === "attention" ? 1 + Math.cos((clock.get() / 1200) * Math.PI * 2) * 13 : state === "sleeping" ? 9 : state === "error" ? 16 : state === "working" ? Math.sin((clock.get() / 3000) * Math.PI * 2) * 7 : 0}deg`,
      },
    ],
  }));
  const closedStyle = useAnimatedStyle(() => ({
    opacity: state === "sleeping" && celebration.get() === 1 ? 1 : 0,
  }));
  const tongueStyle = useAnimatedStyle(() => ({
    opacity: celebration.get() > 0.5 && celebration.get() < 0.85 ? 1 : 0,
  }));
  const pantStyle = useAnimatedStyle(() => ({
    opacity: state === "attention" ? 1 : 0,
    transform: [
      {
        translateY:
          state === "attention"
            ? (1 - Math.cos((clock.get() / 600) * Math.PI * 2)) * dogSize * 0.005
            : 0,
      },
      { scaleY: 1.015 - Math.cos((clock.get() / 600) * Math.PI * 2) * 0.115 },
    ],
  }));

  return (
    <View style={{ width: size * 1.25, height: size }} pointerEvents="none" accessible={false}>
      <Animated.View
        style={[
          { position: "absolute", left: 0, bottom: 0, width: dogSize, height: dogSize },
          dogStyle,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transformOrigin: [
                dogSize * geometry["ear-left"].pivotX,
                dogSize * geometry["ear-left"].pivotY,
                0,
              ],
            },
            leftEarStyle,
          ]}
        >
          <Image source={LEFT_EAR} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transformOrigin: [
                dogSize * geometry["ear-right"].pivotX,
                dogSize * geometry["ear-right"].pivotY,
                0,
              ],
            },
            rightEarStyle,
          ]}
        >
          <Image source={RIGHT_EAR} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Image source={FUR} style={StyleSheet.absoluteFill} />
        <Image
          source={CLOSED_MOUTH}
          style={[StyleSheet.absoluteFill, { opacity: state === "attention" ? 0 : 1 }]}
        />
        {(
          [
            ["eye-left", LEFT_EYE],
            ["eye-right", RIGHT_EYE],
          ] as const
        ).map(([key, source]) => {
          const bounds = geometry[key];
          return (
            <Animated.View
              key={key}
              style={[
                {
                  position: "absolute",
                  left: bounds.left * dogSize,
                  top: bounds.top * dogSize,
                  width: bounds.width * dogSize,
                  height: bounds.height * dogSize,
                },
                eyesStyle,
              ]}
            >
              <Image source={source} style={StyleSheet.absoluteFill} />
            </Animated.View>
          );
        })}
        <Animated.View style={[StyleSheet.absoluteFill, closedStyle]}>
          <Image source={CLOSED} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, tongueStyle]}>
          <Image source={TONGUE} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: [dogSize * 0.61, dogSize * 0.64, 0] },
            pantStyle,
          ]}
        >
          <Image source={PANT} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
      {state === "sleeping"
        ? [0, 1, 2].map((index) => (
            <SleepZ key={index} index={index} size={size} clock={clock} running={running} />
          ))
        : null}
      {state === "working" ? <SpeechBubbles size={size} clock={clock} running={running} /> : null}
      {state === "attention" ? (
        <AttentionMarks size={size} clock={clock} running={running} />
      ) : null}
    </View>
  );
}

function AttentionMarks({
  size,
  clock,
  running,
}: {
  size: number;
  clock: SharedValue<number>;
  running: boolean;
}) {
  const { colorScheme } = useControlTheme();
  const color = colorScheme === "dark" ? "#e8bc66" : "#8c5c12";
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: running
          ? -((1 - Math.cos((clock.get() / 1200) * Math.PI * 2)) / 2) * size * 0.025
          : 0,
      },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          right: -size * 0.02,
          top: -size * 0.07,
          width: size * 0.43,
          height: size * 0.6,
        },
        style,
      ]}
    >
      <AppText
        allowFontScaling={false}
        className="font-t3-bold"
        style={{
          position: "absolute",
          left: 0,
          top: size * 0.03,
          color,
          fontSize: size * 0.46,
          lineHeight: size * 0.53,
          includeFontPadding: false,
          transform: [{ rotate: "-9deg" }],
        }}
      >
        !
      </AppText>
      <AppText
        allowFontScaling={false}
        className="font-t3-bold"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          color,
          fontSize: size * 0.34,
          lineHeight: size * 0.41,
          includeFontPadding: false,
          transform: [{ rotate: "9deg" }],
        }}
      >
        !
      </AppText>
    </Animated.View>
  );
}

function SleepZ({
  index,
  size,
  clock,
  running,
}: {
  index: number;
  size: number;
  clock: SharedValue<number>;
  running: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const p = ((clock.get() - index * 700 + 3200) % 3200) / 3200;
    const opacity =
      p < 0.15 ? 0 : p < 0.28 ? (p - 0.15) / 0.13 : p < 0.65 ? 1 : p < 0.9 ? (0.9 - p) / 0.25 : 0;
    return {
      opacity: running ? opacity : 1,
      transform: [
        { translateX: running ? p * size * 0.035 : 0 },
        { translateY: running ? size * (0.03 - p * 0.16) : 0 },
        { scale: running ? 0.8 + p * 0.35 : 1 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: size * (0.8375 + index * 0.125),
          top: size * (0.33 - index * 0.205),
        },
        style,
      ]}
    >
      <AppText
        allowFontScaling={false}
        className="font-t3-bold text-foreground-muted"
        style={{
          fontSize: size * (0.23 + index * 0.035),
          lineHeight: size * 0.35,
          includeFontPadding: false,
        }}
      >
        {index === 2 ? "Z" : "z"}
      </AppText>
    </Animated.View>
  );
}
function TypingDot({
  index,
  size,
  clock,
  running,
}: {
  index: number;
  size: number;
  clock: SharedValue<number>;
  running: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const phase = ((clock.get() - index * 140 + 1200) % 1200) / 1200;
    const pulse = phase < 0.5 ? Math.sin(phase * Math.PI * 2) : 0;
    return {
      opacity: running ? 0.4 + pulse * 0.6 : 1,
      transform: [{ translateY: running ? -pulse * size * 0.0165 : 0 }],
    };
  });
  return (
    <Animated.View
      style={[
        {
          width: size * 0.055,
          height: size * 0.055,
          borderRadius: size * 0.03,
          backgroundColor: "#475569",
        },
        style,
      ]}
    />
  );
}
function SpeechBubbles({
  size,
  clock,
  running,
}: {
  size: number;
  clock: SharedValue<number>;
  running: boolean;
}) {
  const entrance = useSharedValue(1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animate the native speech bubble once when working begins or motion resumes
  useEffect(() => {
    entrance.set(running ? 0 : 1);
    if (running)
      entrance.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    return () => cancelAnimation(entrance);
  }, [entrance, running]);
  const style = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [
      { translateY: (1 - entrance.get()) * size * 0.04 },
      { scale: 0.94 + entrance.get() * 0.06 },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          right: -size * 0.01,
          top: -size * 0.04,
          width: size * 0.64,
          height: size * 0.533333,
          transformOrigin: [size * 0.16, size * 0.48, 0],
        },
        style,
      ]}
    >
      <Image source={SPEECH_BUBBLE} style={StyleSheet.absoluteFill} />
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "72%",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: size * 0.055,
        }}
      >
        {[0, 1, 2].map((index) => (
          <TypingDot key={index} index={index} size={size} clock={clock} running={running} />
        ))}
      </View>
    </Animated.View>
  );
}
