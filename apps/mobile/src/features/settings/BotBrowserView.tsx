import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import * as Base64 from "effect/encoding/Base64";
import {
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  type BrowserViewInput,
  type OpenbotBrowserViewFeatures,
  type BrowserViewContextMenu,
  type BrowserViewCursor,
} from "@t3tools/contracts";
import { AppState, ScrollView, View, type GestureResponderEvent } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { BotIconButton } from "../bots/upstream/BotChrome";
import { browserTextInput } from "./botBrowserInput";
import { BrowserFrameDraw } from "@t3tools/client-runtime/openbot/presentation";

export function BotBrowserView({
  connect,
  interactive,
}: {
  connect: (viewport?: {
    width: number;
    height: number;
  }) => Promise<WebSocket & { browserFeatures?: OpenbotBrowserViewFeatures }>;
  interactive: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<{ width: number; height: number } | undefined>();
  return (
    <View className="gap-3">
      <View className="flex-row justify-end">
        <Menu
          actions={[
            { id: "retry", title: "Reconnect viewer" },
            { id: "default", title: "Host page size", state: viewport ? "off" : "on" },
            { id: "wide", title: "1280 × 800", state: viewport?.width === 1280 ? "on" : "off" },
            { id: "compact", title: "800 × 600", state: viewport?.width === 800 ? "on" : "off" },
          ]}
          onPressAction={({ nativeEvent }) => {
            switch (nativeEvent.event) {
              case "retry":
                setAttempt((value) => value + 1);
                break;
              case "default":
                setViewport(undefined);
                break;
              case "wide":
                setViewport({ width: 1280, height: 800 });
                break;
              case "compact":
                setViewport({ width: 800, height: 600 });
                break;
            }
          }}
        >
          <BotIconButton label="Viewer options" icon="ellipsis" />
        </Menu>
      </View>
      <BrowserStream
        key={`${attempt}:${viewport?.width ?? 0}`}
        connect={connect}
        interactive={interactive}
        viewport={viewport}
      />
    </View>
  );
}

function BrowserStream({
  connect,
  interactive,
  viewport,
}: {
  connect: (viewport?: {
    width: number;
    height: number;
  }) => Promise<WebSocket & { browserFeatures?: OpenbotBrowserViewFeatures }>;
  interactive: boolean;
  viewport: { width: number; height: number } | undefined;
}) {
  const [status, setStatus] = useState("Connecting browser view…");
  const [connected, setConnected] = useState(false);
  const [features, setFeatures] = useState<OpenbotBrowserViewFeatures | null>(null);
  const [cursor, setCursor] = useState<BrowserViewCursor>("default");
  const [menu, setMenu] = useState<BrowserViewContextMenu | null>(null);
  const [copying, setCopying] = useState(false);
  const copy = useRef<"copy" | "cut" | "writing" | null>(null);
  const control = useRef(interactive);
  const [frame, setFrame] = useState<{
    uri: string;
    width: number;
    height: number;
    sequence: number;
  } | null>(null);
  const [mode, setMode] = useState<"tap" | "scroll" | "drag" | "menu">("tap");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const draw = useRef(new BrowserFrameDraw());
  const layout = useRef({ width: 0, height: 0 });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const contact = useRef<{ x: number; y: number; startedAt: number; scrolling: boolean } | null>(
    null,
  );
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
      copy.current = null;
      setCopying(false);
    };
    const release = () => {
      pressed.current = false;
      touch.current = null;
      contact.current = null;
      if (peer?.readyState === WebSocket.OPEN) peer.send('{"type":"release"}');
    };
    const activity = AppState.addEventListener("change", (state) => {
      if (state !== "active") release();
    });
    void connect(viewport).then(
      (next) => {
        peer = next;
        if (disposed) {
          next.close();
          return;
        }
        socket.current = next;
        setFeatures(next.browserFeatures ?? null);
        next.binaryType = "arraybuffer";
        const opened = () => {
          if (disposed) return;
          setConnected(true);
          setStatus("Browser view connected");
        };
        next.addEventListener("open", opened);
        if (next.readyState === WebSocket.OPEN) opened();
        next.addEventListener("message", (event) => {
          if (disposed) return;
          if (typeof event.data === "string") {
            let message: ReturnType<typeof decodeBrowserViewHostMessage>;
            try {
              message = decodeBrowserViewHostMessage(event.data);
            } catch {
              next.close();
              return;
            }
            if (message?.type === "cursor") setCursor(message.cursor);
            else if (message?.type === "context-menu") setMenu(message);
            else if (
              (message?.type === "copied" || message?.type === "copyTooLarge") &&
              copy.current &&
              copy.current !== "writing"
            ) {
              const cut = copy.current === "cut";
              copy.current = "writing";
              if (message.type === "copyTooLarge") {
                copy.current = null;
                setCopying(false);
                setInputError("The page selection is too large to copy.");
              } else {
                void Clipboard.setStringAsync(message.text)
                  .then(() => {
                    if (disposed) return;
                    if (cut && control.current && next.readyState === WebSocket.OPEN)
                      next.send(JSON.stringify({ type: "cut", text: message.text }));
                    setStatus(
                      cut
                        ? "Selection cut to your clipboard"
                        : "Selection copied to your clipboard",
                    );
                  })
                  .catch(() => {
                    if (!disposed) setInputError("Clipboard access failed.");
                  })
                  .finally(() => {
                    copy.current = null;
                    if (!disposed) setCopying(false);
                  });
              }
            }
            return;
          }
          if (!(event.data instanceof ArrayBuffer)) return;
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
  }, [connect, viewport]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Control loss releases remote capture; socket cleanup handles unmount.
  useEffect(() => {
    control.current = interactive;
    if (interactive) return;
    pressed.current = false;
    touch.current = null;
    const peer = socket.current;
    if (peer?.readyState === WebSocket.OPEN) peer.send('{"type":"release"}');
  }, [interactive]);

  function send(inputs: readonly BrowserViewInput[]) {
    const peer = socket.current;
    if (!control.current || !canInput || peer?.readyState !== WebSocket.OPEN) return false;
    if (
      features?.framePoint &&
      inputs.some((input) => input.type === "pointer") &&
      draw.current.sequence === undefined
    ) {
      if (inputs.some((input) => input.type === "pointer" && input.action === "up"))
        peer.send('{"type":"release"}');
      return false;
    }
    const packets = inputs.map((input) =>
      JSON.stringify(
        input.type === "pointer" && features?.framePoint
          ? { ...input, sequence: draw.current.sequence }
          : input,
      ),
    );
    const bytes = new TextEncoder().encode(packets.join("")).length;
    if (peer.bufferedAmount + bytes >= 8192) {
      peer.close();
      setInputError("The connection is busy. Reconnect to continue.");
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
    button: "left" | "right" = "left",
  ) {
    if (layout.current.width <= 0 || layout.current.height <= 0) return;
    send([
      {
        type: "pointer",
        action,
        x: Math.max(0, Math.min(1, point.x / layout.current.width)),
        y: Math.max(0, Math.min(1, point.y / layout.current.height)),
        button,
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
    const current = contact.current;
    if (pressed.current) pointer("up", point(event));
    else if (current && !current.scrolling && (mode === "tap" || mode === "menu")) {
      const longPress = features?.contextMenu && event.timeStamp - current.startedAt >= 520;
      const button = mode === "menu" || longPress ? "right" : "left";
      pointer("down", point(event), 0, 0, button);
      pointer("up", point(event), 0, 0, button);
    }
    pressed.current = false;
    touch.current = null;
    contact.current = null;
  }
  function sendKey(key: string) {
    send([
      { type: "key", action: "down", key, code: key, text: "", modifiers: 0 },
      { type: "key", action: "up", key, code: key, text: "", modifiers: 0 },
    ]);
  }
  function copySelection(cut = false) {
    if (!canInput || !features?.clipboard || copy.current) return;
    copy.current = cut ? "cut" : "copy";
    setCopying(true);
    if (!send([{ type: "copy" }])) {
      copy.current = null;
      setCopying(false);
    }
  }
  function paste() {
    const peer = socket.current;
    return Clipboard.getStringAsync()
      .then((text) => {
        if (control.current && peer === socket.current) send([{ type: "paste", text }]);
      })
      .catch(() => setInputError("Allow clipboard access to paste into the page."));
  }
  return (
    <View className="gap-3">
      <AppText accessibilityLiveRegion="polite">{status}</AppText>
      {!interactive && (
        <AppText textRole="footnote" className="text-foreground-muted">
          Take control to interact with the page.
        </AppText>
      )}
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
          const next = point(event);
          touch.current = next;
          contact.current = { ...next, startedAt: event.timeStamp, scrolling: mode === "scroll" };
          if (mode === "drag") {
            pressed.current = true;
            pointer("down", point(event));
          }
        }}
        onResponderMove={(event) => {
          const next = point(event);
          const start = contact.current;
          if (mode === "drag") pointer("move", next);
          else if (start && (mode === "tap" || mode === "scroll") && frame) {
            if (!start.scrolling && Math.hypot(next.x - start.x, next.y - start.y) >= 8)
              start.scrolling = true;
            if (
              start.scrolling &&
              touch.current &&
              layout.current.width > 0 &&
              layout.current.height > 0
            )
              pointer(
                "wheel",
                next,
                ((touch.current.x - next.x) * frame.width) / layout.current.width,
                ((touch.current.y - next.y) * frame.height) / layout.current.height,
              );
          }
          touch.current = next;
        }}
        onResponderRelease={finish}
        onResponderTerminate={(event) => {
          if (pressed.current) pointer("up", point(event));
          pressed.current = false;
          touch.current = null;
          contact.current = null;
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
        {(
          ["tap", "scroll", "drag", ...(features?.contextMenu ? ["menu" as const] : [])] as const
        ).map((next) => (
          <Button
            key={next}
            label={`${next === "tap" ? "Touch" : next === "scroll" ? "Scroll" : next === "menu" ? "Page menu" : "Drag"}${mode === next ? " selected" : ""}`}
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
          const clipboard = features?.clipboard === true;
          try {
            if (send(browserTextInput(text, { clipboard }))) setText("");
          } catch (cause) {
            setInputError(cause instanceof Error ? cause.message : "This text could not be sent.");
          }
        }}
      />
      {features?.cursor && <AppText textRole="footnote">Page pointer: {cursor}</AppText>}
      {features?.clipboard && (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Copy selection"
            disabled={!canInput || copying}
            onPress={() => copySelection()}
          />
          <Button
            label="Cut selection"
            disabled={!canInput || copying}
            onPress={() => copySelection(true)}
          />
          <Button label="Paste clipboard" disabled={!canInput} onPress={() => void paste()} />
        </View>
      )}
      {menu && canInput && (
        <View className="gap-2" accessibilityLabel="Page context menu">
          {menu.items.map((item) => (
            <Button
              key={item}
              label={item.replaceAll("-", " ")}
              onPress={() => {
                if (item === "copy" || item === "cut") copySelection(item === "cut");
                else if (item === "paste") void paste();
                else if (item === "select-all")
                  send([
                    {
                      type: "key",
                      action: "down",
                      key: "a",
                      code: "KeyA",
                      text: "",
                      modifiers: features?.selectAllModifiers ?? 2,
                    },
                    { type: "key", action: "up", key: "a", code: "KeyA", text: "", modifiers: 0 },
                  ]);
                else {
                  const text = item === "copy-link" ? menu.link : menu.image;
                  if (text)
                    void Clipboard.setStringAsync(text).catch(() =>
                      setInputError("Clipboard access failed."),
                    );
                }
                setMenu(null);
              }}
            />
          ))}
          <Button label="Close page menu" onPress={() => setMenu(null)} />
        </View>
      )}
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
