import { AppText as Text } from "../../../components/ui/AppText";
import { Pressable, View, type ViewStyle } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { SymbolView, type AppSymbolName } from "../../../components/ui/AppSymbol";
import type { ReactNode } from "react";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";

// OpenBot packages/brand/src/tokens-native.css, scoped to the native Bots surface.
export function useBotPalette() {
  const { themeAppearance } = useAppearancePreferences();
  const dark = themeAppearance === "dark";
  return dark
    ? {
        scheme: "dark" as const,
        canvas: "#141414",
        surface: "#212121",
        control: "#212121",
        text: "#f0f0f0",
        muted: "#a3a3a3",
        warning: "#ff9412",
        warningText: "#ff9412",
        warningSoft: "rgba(255, 148, 18, 0.12)",
        action: "#f0f0f0",
        onAction: "#141414",
        border: "#333335",
      }
    : {
        scheme: "light" as const,
        canvas: "#f5f5f7",
        surface: "#ffffff",
        control: "#e9e9ed",
        text: "#141414",
        muted: "#69696e",
        warning: "#c58a23",
        warningText: "#865700",
        warningSoft: "rgba(240, 138, 0, 0.14)",
        action: "#141414",
        onAction: "#f2f2f2",
        border: "#dddddf",
      };
}
export function BotGlass({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const p = useBotPalette();
  return (
    <GlassView
      glassEffectStyle={isLiquidGlassAvailable() ? "regular" : "none"}
      style={[
        {
          backgroundColor: isLiquidGlassAvailable() ? "transparent" : p.surface,
          borderRadius: 24,
          borderCurve: "continuous",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </GlassView>
  );
}
export function BotIconButton({
  label,
  icon,
  onPress,
  onLongPress,
  filled = false,
  disabled = false,
}: {
  label: string;
  icon: AppSymbolName;
  onPress?: () => void;
  onLongPress?: () => void;
  filled?: boolean;
  disabled?: boolean;
}) {
  const p = useBotPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
        backgroundColor: filled ? p.action : "transparent",
        opacity: disabled ? 0.35 : pressed ? 0.55 : 1,
      })}
    >
      <SymbolView name={icon} size={22} tintColor={filled ? p.onAction : p.text} />
    </Pressable>
  );
}
export function BotCodeButton({ onPress }: { onPress: () => void }) {
  const p = useBotPalette();
  return (
    <BotGlass>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Return to Code"
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingHorizontal: 12,
          flexDirection: "row",
          gap: 5,
          alignItems: "center",
          opacity: pressed ? 0.55 : 1,
        })}
      >
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>Code</Text>
        <SymbolView name="chevron.right" size={13} tintColor={p.text} />
      </Pressable>
    </BotGlass>
  );
}

export function BotHeaderRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        height: 56,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}
