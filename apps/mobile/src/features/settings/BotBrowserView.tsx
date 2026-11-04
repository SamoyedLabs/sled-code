import { useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import * as Base64 from "effect/encoding/Base64";
import { decodeBrowserViewFrame, type BrowserViewInput } from "@t3tools/contracts";
import { AppState, ScrollView, View, type GestureResponderEvent } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { browserTextInput } from "./botBrowserInput";
import { BrowserFrameDraw } from "@t3tools/client-runtime/openbot/presentation";

export function BotBrowserView({
  connect,
  interactive,
}: {
  connect: () => Promise<WebSocket>;
  interactive: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <View className="gap-3">
      <Button label="Reconnect viewer" onPress={() => setAttempt((value) => value + 1)} />
      <BrowserStream key={attempt} connect={connect} interactive={interactive} />
    </View>
  );
}

function BrowserStream({
  connect,
  interactive,
}: {
  connect: () => Promise<WebSocket>;
  interactive: boolean;
}) {
  const [status, setStatus] = useState("Connecting browser view…");
  const [connected, setConnected] = useState(false);
  const [frame, setFrame] = useState<{
    uri: string;
    width: number;
    height: number;
    sequence: number;
  } | null>(null);
  const [mode, setMode] = useState<"tap" | "scroll" | "drag">("tap");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const draw = useRef(new BrowserFrameDraw());
  const layout = useRef({ width: 0, height: 0 });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const canInput = interactive && connected && frame !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns this viewer's authenticated socket and in-memory JPEG frames.
  useEffect(() => {
    let disposed = false;
    let peer: WebSocket | null = null;
    const drawings = draw.current;
    drawings.reset();
    const ended = (message: string) => {
      if (disposed) return;
      setStatus(message);
      setConnected(false);
      setFrame(null);
    };
    const release = () => {
      pressed.current = false;
      touch.current = null;
      if (peer?.readyState === WebSocket.OPEN) peer.send('{"type":"release"}');
    };
    const activity = AppState.addEventListener("change", (state) => {
      if (state !== "active") release();
    });
    void connect().then(
      (next) => {
        peer = next;
        if (disposed) {
          next.close();
          return;
        }
        socket.current = next;
        next.binaryType = "arraybuffer";
        const opened = () => {
          if (disposed) return;
          setConnected(true);
          setStatus("Browser view connected");
        };
        next.addEventListener("open", opened);
        if (next.readyState === WebSocket.OPEN) opened();
        next.addEventListener("message", (event) => {
          if (disposed || !(event.data instanceof ArrayBuffer)) return;
          let nextFrame: ReturnType<typeof decodeBrowserViewFrame>;
          try {
            nextFrame = decodeBrowserViewFrame(new Uint8Array(event.data));
          } catch {
            ended("The browser sent an invalid frame. Reconnect to continue.");
            next.close();
            return;
          }
          const frame = {
            uri: `data:image/jpeg;base64,${Base64.encode(nextFrame.image)}`,
            sequence: nextFrame.sequence,
            width: nextFrame.width,
            height: nextFrame.height,
          };
          const alreadyDrawn = drawings.offer(frame);
          setFrame(frame);
          if (alreadyDrawn && next.readyState === WebSocket.OPEN)
            next.send(JSON.stringify({ type: "ack", sequence: frame.sequence }));
        });
        next.addEventListener("close", () => ended("Browser view closed. Reconnect to continue."));
        next.addEventListener("error", () => {
          ended("Browser view unavailable. Check the host connection.");
          next.close();
        });
      },
      () => ended("Browser view unavailable. Check the host connection."),
    );
    return () => {
      disposed = true;
      drawings.reset();
      release();
      activity.remove();
      peer?.close();
      socket.current = null;
    };
  }, [connect]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Control loss releases remote capture; socket cleanup handles unmount.
  useEffect(() => {
    if (interactive) return;
    pressed.current = false;
    touch.current = null;
    const peer = socket.current;
    if (peer?.readyState === WebSocket.OPEN) peer.send('{"type":"release"}');
  }, [interactive]);

  function send(inputs: readonly BrowserViewInput[]) {
    const peer = socket.current;
    if (!canInput || peer?.readyState !== WebSocket.OPEN) return false;
    const packets = inputs.map((input) => JSON.stringify(input));
    const bytes = new TextEncoder().encode(packets.join("")).length;
    if (peer.bufferedAmount + bytes >= 8192) {
      setInputError("The connection is busy. Wait for the page before sending more input.");
      return false;
    }
    for (const packet of packets) peer.send(packet);
    return true;
  }
  function pointer(
    action: "down" | "up" | "move" | "wheel",
    point: { x: number; y: number },
    deltaX = 0,
    deltaY = 0,
  ) {
    if (layout.current.width <= 0 || layout.current.height <= 0) return;
    send([
      {
        type: "pointer",
        action,
        x: Math.max(0, Math.min(1, point.x / layout.current.width)),
        y: Math.max(0, Math.min(1, point.y / layout.current.height)),
        button: "left",
        clickCount: 1,
        deltaX,
        deltaY,
        modifiers: 0,
      },
    ]);
  }
  function point(event: GestureResponderEvent) {
    return { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
  }
  function finish(event: GestureResponderEvent) {
    if (pressed.current) pointer("up", point(event));
    else if (mode === "tap" && touch.current) {
      pointer("down", point(event));
      pointer("up", point(event));
    }
    pressed.current = false;
    touch.current = null;
  }
  function sendKey(key: string) {
    send([
      { type: "key", action: "down", key, code: key, text: "", modifiers: 0 },
      { type: "key", action: "up", key, code: key, text: "", modifiers: 0 },
    ]);
  }
  return (
    <View className="gap-3">
      <AppText accessibilityLiveRegion="polite">{status}</AppText>
      <AppText textRole="footnote" className="text-foreground-muted">
        {interactive
          ? "Tap the page to focus a field. Choose Scroll or Drag to change touch behavior."
          : "Return to the tab controls and take control before interacting with this page."}
      </AppText>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Live browser page. Touch controls require human control of this tab."
        className="w-full overflow-hidden rounded-2xl border border-border bg-subtle"
        style={{ aspectRatio: frame ? frame.width / frame.height : 1.5, borderCurve: "continuous" }}
        onLayout={(event) => {
          layout.current = event.nativeEvent.layout;
        }}
        onStartShouldSetResponder={() => canInput}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          touch.current = point(event);
          if (mode === "drag") {
            pressed.current = true;
            pointer("down", point(event));
          }
        }}
        onResponderMove={(event) => {
          const next = point(event);
          if (mode === "drag") pointer("move", next);
          else if (mode === "scroll" && touch.current && frame && layout.current.width > 0)
            pointer(
              "wheel",
              next,
              ((touch.current.x - next.x) * frame.width) / layout.current.width,
              ((touch.current.y - next.y) * frame.height) / layout.current.height,
            );
          touch.current = next;
        }}
        onResponderRelease={finish}
        onResponderTerminate={(event) => {
          if (pressed.current) pointer("up", point(event));
          pressed.current = false;
          touch.current = null;
        }}
      >
        {frame && (
          <Image
            source={{ uri: frame.uri }}
            onLoad={() => {
              const peer = socket.current;
              const sequence = draw.current.loaded(frame.sequence);
              if (sequence !== undefined && peer?.readyState === WebSocket.OPEN)
                peer.send(JSON.stringify({ type: "ack", sequence }));
            }}
            onError={() => socket.current?.close()}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
            cachePolicy="none"
            transition={0}
            accessible={false}
            pointerEvents="none"
          />
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
      >
        {(["tap", "scroll", "drag"] as const).map((next) => (
          <Button
            key={next}
            label={`${next === "tap" ? "Tap" : next === "scroll" ? "Scroll" : "Drag"}${mode === next ? " selected" : ""}`}
            disabled={!canInput}
            tone={mode === next ? "primary" : "secondary"}
            onPress={() => setMode(next)}
          />
        ))}
      </ScrollView>
      <AppTextInput
        accessibilityLabel="Text to type in the focused browser field"
        placeholder="Text for the focused page field"
        value={text}
        onChangeText={setText}
        editable={canInput}
        maxLength={64}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
      />
      <Button
        label="Type text in page"
        disabled={!canInput || !text}
        onPress={() => {
          setInputError(null);
          try {
            if (send(browserTextInput(text))) setText("");
          } catch (cause) {
            setInputError(cause instanceof Error ? cause.message : "This text could not be sent.");
          }
        }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
      >
        {["Enter", "Tab", "Backspace", "Escape"].map((name) => (
          <Button key={name} label={name} disabled={!canInput} onPress={() => sendKey(name)} />
        ))}
      </ScrollView>
      {inputError && <AppText accessibilityRole="alert">{inputError}</AppText>}
    </View>
  );
}
