import { useBotReducedMotion } from "./botFeedback";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { ReduceMotion, SlideOutUp, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { OpenBotText } from "./upstream/OpenBotTypography";
import { BloubEyes } from "./upstream/openbot-mobile/shared/components/bloub-stage/bloub-eyes";
import { SPLASH_EASE_IN_OUT } from "./upstream/openbot-mobile/shared/lib/splash-motion";

const exit = SlideOutUp.duration(560).easing(SPLASH_EASE_IN_OUT).reduceMotion(ReduceMotion.System);

export function BotRosterLoading({ label }: { label: string }) {
  const { bottom } = useSafeAreaInsets();
  const { themeAppearance } = useAppearancePreferences();
  const dark = themeAppearance === "dark";
  const reduced = useBotReducedMotion();
  const focused = useIsFocused();
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const [slow, setSlow] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the slow-launch caption in sync with a timer while the loader remains mounted.
  useEffect(() => {
    const timeout = setTimeout(() => setSlow(true), 700);
    return () => clearTimeout(timeout);
  }, []);

  // The loader uses the source's radial light and its half-canvas body in dark mode.
  const body = dark ? "#716180" : "#d6adf2";
  const light = dark ? "#827491" : "#ebd6f9";
  return (
    <Animated.View
      exiting={exit}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: body,
          experimental_backgroundImage: `radial-gradient(120% 70% at 18% 0%, ${light} 0%, ${body} 58%)`,
        },
      ]}
    >
      <BloubEyes
        mood={slow ? "think" : "idle"}
        active={focused}
        reduced={reduced}
        gazeX={gazeX}
        gazeY={gazeY}
        eyeColor="#040007"
      />
      {slow && (
        <View style={{ position: "absolute", bottom: bottom + 32, left: 24, right: 24 }}>
          <OpenBotText style={{ color: "#040007", textAlign: "center", fontSize: 13 }}>
            {label}
          </OpenBotText>
        </View>
      )}
    </Animated.View>
  );
}
