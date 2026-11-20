import { useFonts } from "expo-font";
import { createContext, use, type ReactNode } from "react";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";

const fonts = {
  Inter: require("./openbot-mobile/assets/Inter-Regular.ttf"),
  "Inter-SemiBold": require("./openbot-mobile/assets/Inter-SemiBold.ttf"),
  "Inter-Bold": require("./openbot-mobile/assets/Inter-Bold.ttf"),
};
const InterReady = createContext(false);

export function OpenBotTypography({ children }: { children: ReactNode }) {
  const [ready] = useFonts(fonts);
  return <InterReady value={ready}>{children}</InterReady>;
}

export function useOpenBotFont(weight?: TextStyle["fontWeight"]): string | undefined {
  if (!use(InterReady)) return undefined;
  if (weight === "bold" || Number(weight) >= 700) return "Inter-Bold";
  if (Number(weight) >= 600) return "Inter-SemiBold";
  return "Inter";
}

export function OpenBotText({ style, ...props }: TextProps) {
  const font = useOpenBotFont(StyleSheet.flatten(style)?.fontWeight);
  return <Text {...props} style={[style, font && { fontFamily: font, fontWeight: "normal" }]} />;
}
