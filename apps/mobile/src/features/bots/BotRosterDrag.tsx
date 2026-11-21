// The hold, drag, drop mark, and edge scroll follow OpenBot iOS 1.4.11's chat-drag component.
import { ImpactFeedbackStyle, impactAsync, selectionAsync } from "./botFeedback";
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { GestureDetector, GestureStateManager, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { botRosterItemKey, type BotRosterPin } from "./bot-roster-pin";
import {
  chatDropChange,
  chatDropTarget,
  type DraggedChat,
  type DragRect,
  type DropChange,
  type DropMark,
  type ListFrame,
} from "./bot-roster-drag-model";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";

export type RosterDragItem =
  | { kind: "section"; id: string; open: boolean }
  | { kind: "chat"; chat: BotRosterPin; sectionId: string | null };

type Point = { x: number; y: number };
type Source = DraggedChat & { name: string; preview: ReactNode };
const HOLD_MS = 250;
const SCROLL_SLOP = 6;
const DRAG_SLOP = 8;
const EDGE = 72;
const pointAt = (x: number, y: number): Point => ({ x, y });
const rowKey = (place: "pin" | "row", chat: BotRosterPin) => `${place}:${botRosterItemKey(chat)}`;
export const pinDropKey = "pin-area";
export const sectionDropKey = (id: string) => `section:${id}`;

function measure(view?: ViewInstance | null): DragRect | null {
  const rect = view?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

const DragContext = createContext<{
  register: (key: string, view: ViewInstance | null) => void;
  begin: (key: string, source: Source, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (drop: boolean) => void;
} | null>(null);

export type RosterDragScroll = {
  bounds: () => { top: number; bottom: number };
  by: (delta: number) => boolean;
  setDragging: (dragging: boolean) => void;
};

export function BotRosterDrag({
  children,
  items,
  pins,
  canPin,
  layout,
  scroll,
  onDrop,
}: PropsWithChildren<{
  items: readonly RosterDragItem[];
  pins: readonly BotRosterPin[];
  canPin: boolean;
  layout: Parameters<typeof chatDropChange>[3];
  scroll: RosterDragScroll;
  onDrop: (change: DropChange) => void;
}>) {
  const p = useBotPalette();
  const root = useRef<ViewInstance>(null);
  const targets = useRef(new Map<string, ViewInstance>());
  const screen = useRef({ items, pins, canPin, layout, scroll, onDrop });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The native drag driver reads committed drop targets from animation frames.
  useEffect(() => {
    screen.current = { items, pins, canPin, layout, scroll, onDrop };
  }, [items, pins, canPin, layout, scroll, onDrop]);
  const session = useRef<{
    source: Source;
    point: Point;
    grab: Point;
    change: DropChange;
    target: string | null;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const ghostPosition = useSharedValue<Point>({ x: 0, y: 0 });
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ghostPosition.get().x }, { translateY: ghostPosition.get().y }],
  }));
  const [ghost, setGhost] = useState<Source | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  const tickRef = useRef<(time: number) => void>(() => {});
  const tick = useCallback(
    (time: number) => {
      frame.current = null;
      const elapsed =
        lastFrame.current === null ? 1000 / 60 : Math.min(time - lastFrame.current, 50);
      lastFrame.current = null;
      const current = session.current;
      const origin = measure(root.current);
      if (!current || !origin) return;
      const { items, pins, canPin, layout, scroll } = screen.current;
      const { x, y } = current.point;
      const { top, bottom } = scroll.bounds();
      const reach = (14 * elapsed * 60) / 1000;
      const step =
        y < top + EDGE
          ? -reach * Math.min(1, (top + EDGE - y) / EDGE)
          : y > bottom - EDGE
            ? reach * Math.min(1, (y - bottom + EDGE) / EDGE)
            : 0;
      const scrolled = step !== 0 && scroll.by(step);
      const bounds = targets.current;
      const list: ListFrame[] = items.flatMap((item): ListFrame[] => {
        const rect = measure(
          bounds.get(item.kind === "section" ? sectionDropKey(item.id) : rowKey("row", item.chat)),
        );
        if (!rect || rect.y + rect.height < top || rect.y > bottom) return [];
        return [{ ...item, rect }];
      });
      const tiles = pins.flatMap((chat) => {
        const rect = measure(bounds.get(rowKey("pin", chat)));
        return rect ? [{ chat, rect }] : [];
      });
      const pinArea = measure(bounds.get(pinDropKey));
      const found =
        x >= origin.x && x <= origin.x + origin.width && y >= top && y <= bottom
          ? chatDropTarget({ pinArea, pins: tiles, list }, current.source, x, y, {
              canPin,
              sections: layout !== null,
            })
          : null;
      const change = found ? chatDropChange(current.source, found.target, pins, layout) : {};
      current.change = change;
      const useful = found && (change.pins || change.move) ? found : null;
      const target = useful ? JSON.stringify(useful.target) : null;
      if (target && target !== current.target) void selectionAsync();
      current.target = target;
      ghostPosition.set(pointAt(x - origin.x - current.grab.x, y - origin.y - current.grab.y));
      const next = useful
        ? {
            ...useful.mark,
            rect: {
              ...useful.mark.rect,
              x: useful.mark.rect.x - origin.x,
              y: useful.mark.rect.y - origin.y,
            },
          }
        : null;
      setMark((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
      if (scrolled) {
        lastFrame.current = time;
        frame.current = requestAnimationFrame((nextTime) => tickRef.current(nextTime));
      }
    },
    [ghostPosition],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the animation frame loop pointing at the latest tick callback.
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastFrame.current = null;
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the native scroll lock and animation frame when the roster unmounts during a drag.
  useEffect(
    () => () => {
      cancelFrame();
      if (session.current) screen.current.scroll.setDragging(false);
    },
    [cancelFrame],
  );

  const value = useMemo(() => {
    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    };
    return {
      register(key: string, view: ViewInstance | null) {
        if (view) targets.current.set(key, view);
        else targets.current.delete(key);
      },
      begin(key: string, source: Source, x: number, y: number) {
        if (session.current) return;
        const rect = measure(targets.current.get(key));
        const grab = rect
          ? pointAt(
              Math.min(64, Math.max(0, x - rect.x)),
              Math.min(rect.height, Math.max(0, y - rect.y)),
            )
          : pointAt(32, 32);
        session.current = { source, point: pointAt(x, y), grab, change: {}, target: null };
        const origin = measure(root.current);
        ghostPosition.set(pointAt(x - (origin?.x ?? 0) - grab.x, y - (origin?.y ?? 0) - grab.y));
        setGhost(source);
        screen.current.scroll.setDragging(true);
        void impactAsync(ImpactFeedbackStyle.Medium);
        schedule();
      },
      move(x: number, y: number) {
        if (!session.current) return;
        session.current.point = pointAt(x, y);
        schedule();
      },
      end(drop: boolean) {
        if (drop && frame.current !== null) {
          cancelFrame();
          tick(performance.now());
        }
        const current = session.current;
        session.current = null;
        cancelFrame();
        setGhost(null);
        setMark(null);
        screen.current.scroll.setDragging(false);
        if (drop && current?.target) {
          void impactAsync(ImpactFeedbackStyle.Light);
          screen.current.onDrop(current.change);
        }
      },
    };
  }, [cancelFrame, ghostPosition, tick]);

  return (
    <DragContext.Provider value={value}>
      <View ref={root} collapsable={false}>
        {children}
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
          {mark && (
            <View
              style={{
                position: "absolute",
                left: mark.rect.x,
                top: mark.rect.y,
                width: mark.rect.width,
                height: mark.rect.height,
                ...(mark.shape === "zone"
                  ? { borderRadius: 20, borderWidth: 2, borderColor: "#0a84ff" }
                  : { borderRadius: 2, backgroundColor: "#0a84ff" }),
              }}
            />
          )}
          {ghost && (
            <Animated.View style={[{ position: "absolute", left: 0, top: 0 }, ghostStyle]}>
              <View
                className="flex-row items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4"
                style={{ maxWidth: 260, backgroundColor: p.surface, boxShadow: "0 8px 18px #0003" }}
              >
                {ghost.preview}
                <Text numberOfLines={1} style={{ flexShrink: 1, fontWeight: "600", color: p.text }}>
                  {ghost.name}
                </Text>
              </View>
            </Animated.View>
          )}
        </View>
      </View>
    </DragContext.Provider>
  );
}

export function RosterDropArea({ target, children }: PropsWithChildren<{ target: string }>) {
  const drag = useContext(DragContext);
  const ref = useCallback(
    (view: ViewInstance | null) => drag?.register(target, view),
    [drag, target],
  );
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  );
}

export function RosterDragRow({
  place,
  source,
  children,
}: PropsWithChildren<{
  place: "pin" | "row";
  source: Source;
}>) {
  const drag = useContext(DragContext);
  const key = rowKey(place, source.chat);
  const origin = useSharedValue({ x: 0, y: 0, at: 0 });
  const active = useSharedValue(false);
  const begin = (x: number, y: number) => drag?.begin(key, source, x, y);
  const move = (x: number, y: number) => drag?.move(x, y);
  const end = (drop: boolean) => drag?.end(drop);
  const gesture = usePanGesture({
    enabled: drag !== null,
    manualActivation: true,
    maxPointers: 1,
    onTouchesDown(event) {
      "worklet";
      const touch = event.allTouches[0];
      if (touch) origin.set({ x: touch.absoluteX, y: touch.absoluteY, at: Date.now() });
    },
    onTouchesMove(event) {
      "worklet";
      if (active.get()) return;
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches > 1) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const start = origin.get();
      const distance = Math.hypot(touch.absoluteX - start.x, touch.absoluteY - start.y);
      if (Date.now() - start.at < HOLD_MS) {
        if (distance > SCROLL_SLOP) GestureStateManager.fail(event.handlerTag);
      } else if (distance > DRAG_SLOP) GestureStateManager.activate(event.handlerTag);
    },
    onActivate(event) {
      "worklet";
      active.set(true);
      scheduleOnRN(begin, event.absoluteX, event.absoluteY);
    },
    onUpdate(event) {
      "worklet";
      scheduleOnRN(move, event.absoluteX, event.absoluteY);
    },
    onFinalize(event) {
      "worklet";
      if (!active.get()) return;
      active.set(false);
      scheduleOnRN(end, !event.canceled);
    },
  });
  const dragStyle = useAnimatedStyle(() => ({ opacity: active.get() ? 0.35 : 1 }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={dragStyle}>
        <RosterDropArea target={key}>{children}</RosterDropArea>
      </Animated.View>
    </GestureDetector>
  );
}
