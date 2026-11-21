import type { EnvironmentId } from "@t3tools/contracts";
import { type PropsWithChildren, useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useBotReducedMotion } from "./botFeedback";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { EnvironmentPresentation } from "../../state/environments";
import { BotGlass, BotIconButton, useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { T, useGT } from "gt-react-native";

const DRAWER_SPRING = {
  dampingRatio: 0.8,
  duration: 300,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

export function BotComputerDrawer({
  open,
  onOpenChange,
  canOpen,
  onAdd,
  onManage,
  onLibrary,
  onSelect,
  activeId,
  environments,
  children,
}: PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canOpen: boolean;
  onAdd: () => void;
  onManage: () => void;
  onLibrary?: (() => void) | undefined;
  onSelect: (environmentId: EnvironmentId) => void;
  activeId: EnvironmentId | undefined;
  environments: readonly EnvironmentPresentation[];
}>) {
  const gt = useGT();
  const p = useBotPalette();
  const reducedMotion = useBotReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(360, Math.max(0, width - insets.right - 52));
  const progress = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const close = () => onOpenChange(false);
  // The native surface follows the same spring for touch dismissal and button toggles.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Translate the drawer on the UI runtime.
  useEffect(() => {
    const target = open ? 1 : 0;
    progress.set(reducedMotion ? target : withSpring(target, DRAWER_SPRING));
  }, [open, progress, reducedMotion]);
  const surface = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerWidth * progress.get() }],
    borderRadius: Math.max(34, insets.top) * Math.min(1, progress.get() / 0.15),
  }));
  const contents = useAnimatedStyle(() => ({
    transform: [{ translateX: -32 * (1 - progress.get()) }],
    opacity: progress.get(),
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: 0.28 * progress.get() }));
  const swipe = usePanGesture({
    enabled: drawerWidth > 0 && (open || canOpen),
    activeOffsetX: open ? -12 : 12,
    failOffsetX: open ? 10 : -10,
    failOffsetY: [-18, 18],
    onActivate: () => {
      "worklet";
      cancelAnimation(progress);
      dragStart.set(progress.get());
    },
    onUpdate: ({ translationX }) => {
      "worklet";
      progress.set(Math.max(0, Math.min(1, dragStart.get() + translationX / drawerWidth)));
    },
    onDeactivate: ({ canceled, velocityX }) => {
      "worklet";
      const projected = progress.get() + velocityX / drawerWidth / 6;
      const nextOpen = canceled ? open : projected > (open ? 0.65 : 0.45);
      if (nextOpen !== open) scheduleOnRN(onOpenChange, nextOpen);
      else {
        const target = open ? 1 : 0;
        progress.set(reducedMotion ? target : withSpring(target, DRAWER_SPRING));
      }
    },
  });
  return (
    <GestureDetector gesture={swipe}>
      <View style={{ flex: 1, backgroundColor: p.surface }}>
        <Animated.View
          onAccessibilityEscape={close}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          pointerEvents={open ? "auto" : "none"}
          style={[
            {
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: drawerWidth,
              paddingTop: insets.top + 10,
              paddingLeft: Math.max(insets.left, 18),
              paddingRight: 12,
              paddingBottom: Math.max(insets.bottom, 12),
            },
            contents,
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingBottom: 14,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: p.text, fontSize: 24, fontWeight: "700" }}
            >
              <T>Servers</T>
            </Text>
            <BotGlass>
              <BotIconButton label={gt("Add server")} icon="plus" onPress={onAdd} />
            </BotGlass>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {environments.map((environment) => {
              const selected = environment.environmentId === activeId;
              const connected = environment.connection.phase === "connected";
              return (
                <Pressable
                  key={environment.environmentId}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(environment.environmentId)}
                  style={({ pressed }) => ({
                    minHeight: 58,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 16,
                    borderCurve: "continuous",
                    backgroundColor: selected || pressed ? p.border : "transparent",
                  })}
                >
                  <SymbolView name="desktopcomputer" size={24} tintColor={p.muted} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: p.text, fontSize: 15, fontWeight: "600" }}
                    >
                      {environment.label}
                    </Text>
                    <Text style={{ color: p.muted, fontSize: 12 }}>
                      {connected
                        ? gt("Connected")
                        : environment.connection.phase === "reconnecting"
                          ? gt("Reconnecting")
                          : gt("Disconnected")}
                    </Text>
                  </View>
                  {selected && <SymbolView name="checkmark" size={17} tintColor={p.text} />}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 12 }}>
            {onLibrary ? (
              <BotGlass>
                <BotIconButton label={gt("Library")} icon="square.grid.2x2" onPress={onLibrary} />
              </BotGlass>
            ) : (
              <View />
            )}
            <BotGlass>
              <BotIconButton label={gt("Settings")} icon="gearshape" onPress={onManage} />
            </BotGlass>
          </View>
        </Animated.View>
        <Animated.View
          style={[{ flex: 1, overflow: "hidden", borderCurve: "continuous" }, surface]}
        >
          <View
            style={{ flex: 1 }}
            pointerEvents={open ? "none" : "auto"}
            accessibilityElementsHidden={open}
            importantForAccessibility={open ? "no-hide-descendants" : "auto"}
          >
            {children}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, scrim]}
          />
          {open && (
            <Pressable
              accessibilityLabel={gt("Close computer drawer")}
              accessibilityRole="button"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
