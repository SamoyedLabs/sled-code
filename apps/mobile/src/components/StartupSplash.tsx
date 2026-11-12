import { Image } from "expo-image";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { darkMascot } from "../lib/mascotBranding";

import geometry from "../../../../assets/branding/startup/geometry.json";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { useAppActive, useReduceMotionEnabled } from "../lib/appState";

const SIZE = 200;
const DURATION = 1080;
// Scoped to this JS launch: navigation, auth remounts and foregrounding cannot replay it.
let startupFinished = false;
const layers = {
  "ear-left": darkMascot
    ? require("../../../../assets/branding/startup-dev/ear-left.png")
    : require("../../../../assets/branding/startup/ear-left.png"),
  "ear-right": darkMascot
    ? require("../../../../assets/branding/startup-dev/ear-right.png")
    : require("../../../../assets/branding/startup/ear-right.png"),
  fur: darkMascot
    ? require("../../../../assets/branding/startup-dev/fur.png")
    : require("../../../../assets/branding/startup/fur.png"),
  tongue: darkMascot
    ? require("../../../../assets/branding/startup-dev/tongue.png")
    : require("../../../../assets/branding/startup/tongue.png"),
  mouth: darkMascot
    ? require("../../../../assets/branding/startup-dev/mouth.png")
    : require("../../../../assets/branding/startup/mouth.png"),
  nose: darkMascot
    ? require("../../../../assets/branding/startup-dev/nose.png")
    : require("../../../../assets/branding/startup/nose.png"),
  "eye-left": darkMascot
    ? require("../../../../assets/branding/startup-dev/eye-left.png")
    : require("../../../../assets/branding/startup/eye-left.png"),
  "eye-right": darkMascot
    ? require("../../../../assets/branding/startup-dev/eye-right.png")
    : require("../../../../assets/branding/startup/eye-right.png"),
};
type Layer = keyof typeof layers;

function sample(time: number, stops: number[], values: number[]) {
  "worklet";
  return interpolate(time, stops, values, Extrapolation.CLAMP);
}

export function StartupSplash({ ready = true }: { readonly ready?: boolean }) {
  const { isReady, themeAppearance } = useAppearancePreferences();
  const reduced = useReduceMotionEnabled();
  const active = useAppActive();
  const [laidOut, setLaidOut] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlySet<Layer>>(() => new Set());
  const [finished, setFinished] = useState(() => startupFinished);
  const time = useSharedValue(0);
  const finish = useCallback(() => {
    startupFinished = true;
    setFinished(true);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hand off the OS launch screen only after the appearance and local raster layers can paint; the UI-thread clock plays once over the loading app
  useEffect(() => {
    if (
      !ready ||
      !active ||
      !isReady ||
      !laidOut ||
      loaded.size !== Object.keys(layers).length ||
      finished
    )
      return;
    SplashScreen.hide();
    const remaining = DURATION - time.get();
    time.set(
      withTiming(
        DURATION,
        {
          duration: remaining * (reduced ? 120 / DURATION : 1),
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        },
        (complete) => {
          if (complete) scheduleOnRN(finish);
        },
      ),
    );
    return () => cancelAnimation(time);
  }, [active, finish, finished, isReady, laidOut, loaded, ready, reduced, time]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: sample(time.get(), reduced ? [0, DURATION] : [880, DURATION], [1, 0]),
  }));
  const dogStyle = useAnimatedStyle(() => {
    const t = reduced ? 0 : time.get();
    return {
      transform: [
        { translateY: SIZE * sample(t, [0, 90, 230, 360, 440], [0, 0.03125, -0.0586, 0.0078, 0]) },
        {
          scaleX: sample(
            t,
            [0, 90, 230, 360, 440, 880, DURATION],
            [1, 1.035, 0.98, 1.015, 1, 1, 1.06],
          ),
        },
        {
          scaleY: sample(
            t,
            [0, 90, 230, 360, 440, 880, DURATION],
            [1, 0.965, 1.025, 0.985, 1, 1, 1.06],
          ),
        },
      ],
    };
  });
  const leftEarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${reduced ? 0 : sample(time.get(), [100, 250, 450, 500, 560, 700], [0, -12, 0, 0, -7, 0])}deg`,
      },
    ],
  }));
  const rightEarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${reduced ? 0 : sample(time.get(), [120, 270, 470, 500, 560, 700], [0, 12, 0, 0, 7, 0])}deg`,
      },
    ],
  }));
  const eyeStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: reduced ? 1 : sample(time.get(), [30, 90, 180], [1, 0.06, 1]) }],
  }));
  const noseStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: reduced
          ? 0
          : sample(
              time.get(),
              [420, 470, 520, 570, 620],
              [0, -SIZE * 0.0049, 0, -SIZE * 0.0049, 0],
            ),
      },
      { scale: reduced ? 1 : sample(time.get(), [420, 470, 520, 570, 620], [1, 1.05, 1, 1.05, 1]) },
    ],
  }));
  const tongueStyle = useAnimatedStyle(() => {
    const amount = reduced ? 0 : sample(time.get(), [620, 720, 800, 880], [0, 1, 1, 0]);
    return { opacity: amount, transform: [{ scaleY: Math.max(0.01, amount) }] };
  });

  if (finished) return null;
  const motion = {
    "ear-left": leftEarStyle,
    "ear-right": rightEarStyle,
    fur: undefined,
    tongue: tongueStyle,
    mouth: undefined,
    nose: noseStyle,
    "eye-left": eyeStyle,
    "eye-right": eyeStyle,
  };
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={() => setLaidOut(true)}
      style={[
        styles.overlay,
        { backgroundColor: themeAppearance === "dark" ? "#0a0a0a" : "#ffffff" },
        overlayStyle,
      ]}
    >
      <Animated.View style={[styles.dog, dogStyle]}>
        {(Object.keys(layers) as Layer[]).map((name) => {
          const pivot = name in geometry ? geometry[name as keyof typeof geometry] : null;
          return (
            <Animated.View
              key={name}
              style={[
                StyleSheet.absoluteFill,
                pivot
                  ? { transformOrigin: [SIZE * pivot.pivotX, SIZE * pivot.pivotY, 0] }
                  : undefined,
                motion[name],
              ]}
            >
              <Image
                source={layers[name]}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={0}
                onLoadEnd={() =>
                  setLoaded((previous) =>
                    previous.has(name) ? previous : new Set([...previous, name]),
                  )
                }
                onError={() => {
                  SplashScreen.hide();
                  finish();
                }}
              />
            </Animated.View>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
  },
  dog: { width: SIZE, height: SIZE },
});
