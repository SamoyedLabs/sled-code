import { useIsFocused } from "@react-navigation/native";
import { createContext, type ReactNode } from "react";
import { Platform, View } from "react-native";
import {
  GestureDetector,
  GestureStateManager,
  usePanGesture,
  type PanGesture,
} from "react-native-gesture-handler";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { BOTS_SCREEN_EDGE_WIDTH, isBotsEdgeRoot, shouldOpenBots } from "./bots-edge-gesture";

export const BotsEdgeGestureContext = createContext<PanGesture | undefined>(undefined);

export function BotsEdgeGesture({
  routeName,
  children,
}: {
  routeName: string;
  children: ReactNode;
}) {
  const focused = useIsFocused();
  const edgeOnly = routeName === "Thread";
  const gesture = usePanGesture({
    enabled: Platform.OS === "ios" && focused && isBotsEdgeRoot(routeName),
    hitSlop: edgeOnly ? { left: 0, width: BOTS_SCREEN_EDGE_WIDTH } : undefined,
    maxPointers: 1,
    activeOffsetX: 16,
    failOffsetX: -8,
    failOffsetY: [-20, 20],
    runOnJS: true,
    onTouchesDown: (event) => {
      const touch = event.allTouches[0];
      if (!touch || (edgeOnly && touch.absoluteX > BOTS_SCREEN_EDGE_WIDTH))
        GestureStateManager.fail(event.handlerTag);
    },
    onDeactivate: (event) => {
      if (
        !event.canceled &&
        shouldOpenBots(routeName, event.translationX, event.translationY, event.velocityX) &&
        rootNavigationRef.isReady()
      ) {
        rootNavigationRef.navigate("Bots", {
          openRoster: routeName === "Home",
          openingVelocity: event.velocityX,
        });
      }
    },
  });
  if (Platform.OS !== "ios") return children;
  return (
    <BotsEdgeGestureContext value={gesture}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={{ flex: 1 }}>
          {children}
        </View>
      </GestureDetector>
    </BotsEdgeGestureContext>
  );
}
