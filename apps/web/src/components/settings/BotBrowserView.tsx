/* oxlint-disable shadcn/no-unknown-classes -- Optional source chrome preserves the existing browser stream and input transport. */
import { useEffect, useRef, useState } from "react";
import {
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  type BrowserViewInput,
  type OpenbotBrowserViewFeatures,
  type BrowserViewContextMenu,
  type BrowserViewCursor,
} from "@t3tools/contracts";
import { BrowserKeyboard } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";

// connect must create an authenticated Sled viewer grant and socket for this host/tab.
// No upstream endpoint or credential is accepted by this component.
export function BotBrowserView({
  connect,
  interactive,
  source = false,
}: {
  connect: (viewport?: {
    width: number;
    height: number;
  }) => Promise<WebSocket & { browserFeatures?: OpenbotBrowserViewFeatures }>;
  interactive: boolean;
  source?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<{ width: number; height: number } | undefined>();
  return (
    <section aria-label="Live bot browser" className={source ? "browser-live-view" : undefined}>
      {!source && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Reconnect
          </Button>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Page size
            <select
              aria-label="Browser viewport"
              className="rounded-md border bg-background px-2 py-1.5"
              value={viewport?.width ?? "host"}
              onChange={(event) => {
                const value = event.target.value;
                setViewport(
                  value === "1280"
                    ? { width: 1280, height: 800 }
                    : value === "800"
                      ? { width: 800, height: 600 }
                      : undefined,
                );
              }}
            >
              <option value="host">Match host</option>
              <option value="1280">1280 × 800</option>
              <option value="800">800 × 600</option>
            </select>
          </label>
        </div>
      )}
      <BrowserStream
        key={`${attempt}:${viewport?.width ?? 0}`}
        connect={connect}
        interactive={interactive}
        viewport={viewport}
        source={source}
        onReconnect={() => setAttempt((value) => value + 1)}
      />
    </section>
  );
}
function BrowserStream({
  connect,
  interactive,
  viewport,
  source,
  onReconnect,
}: {
  connect: (viewport?: {
    width: number;
    height: number;
  }) => Promise<WebSocket & { browserFeatures?: OpenbotBrowserViewFeatures }>;
  interactive: boolean;
  viewport: { width: number; height: number } | undefined;
  source: boolean;
  onReconnect: () => void;
}) {
  const [status, setStatus] = useState("Connecting browser view…");
  const [features, setFeatures] = useState<OpenbotBrowserViewFeatures | null>(null);
  const [cursor, setCursor] = useState<BrowserViewCursor>("default");
  const [menu, setMenu] = useState<BrowserViewContextMenu | null>(null);
  const [copying, setCopying] = useState(false);
  const copy = useRef<{ resolve: (text: string) => void; reject: (error: Error) => void } | null>(
    null,
  );
  const drawnSequence = useRef<number | undefined>(undefined);
  const image = useRef<HTMLImageElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<number | null>(null);
  const pressed = useRef<"left" | "middle" | "right" | null>(null);
  const keyboard = useRef(new BrowserKeyboard());
  const control = useRef(interactive);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Control loss releases remote capture without replacing the viewer socket.
  useEffect(() => {
    control.current = interactive;
    if (!interactive) {
      keyboard.current.release();
      pressed.current = null;
      const pointerId = capture.current;
      capture.current = null;
      const surface = image.current;
      if (pointerId !== null && surface?.hasPointerCapture(pointerId))
        surface.releasePointerCapture(pointerId);
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send('{"type":"release"}');
    }
  }, [interactive]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the authenticated browser socket and image object URLs for this mounted viewer.
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    let peer: (WebSocket & { browserFeatures?: OpenbotBrowserViewFeatures }) | null = null;
    const surface = image.current;
    const keys = keyboard.current;
    const releaseKeys = () => {
      keys.release();
      pressed.current = null;
      const pointerId = capture.current;
      capture.current = null;
      if (pointerId !== null && surface?.hasPointerCapture(pointerId))
        surface.releasePointerCapture(pointerId);
      if (peer?.readyState === WebSocket.OPEN) peer.send('{"type":"release"}');
    };
    const hidden = () => {
      if (document.hidden) releaseKeys();
    };
    const lostCapture = (event: PointerEvent) => {
      if (capture.current === event.pointerId) releaseKeys();
    };
    drawnSequence.current = undefined;
    const drawn = () => {
      if (sequence !== null) drawnSequence.current = sequence;
      if (peer?.readyState === WebSocket.OPEN && sequence !== null)
        peer.send(JSON.stringify({ type: "ack", sequence }));
    };
    let sequence: number | null = null;
    const failed = () => peer?.close();
    surface?.addEventListener("load", drawn);
    surface?.addEventListener("error", failed);
    surface?.addEventListener("blur", releaseKeys);
    surface?.addEventListener("lostpointercapture", lostCapture);
    document.addEventListener("visibilitychange", hidden);
    const wheel = (event: WheelEvent) => {
      if (!surface || !control.current || peer?.readyState !== WebSocket.OPEN) return;
      if (peer.browserFeatures?.framePoint && drawnSequence.current === undefined) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      peer.send(
        JSON.stringify({
          type: "pointer",
          ...(peer.browserFeatures?.framePoint ? { sequence: drawnSequence.current } : {}),
          action: "wheel",
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
          button: "left",
          clickCount: 1,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          modifiers:
            (event.altKey ? 1 : 0) |
            (event.ctrlKey ? 2 : 0) |
            (event.metaKey ? 4 : 0) |
            (event.shiftKey ? 8 : 0),
        }),
      );
    };
    surface?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", releaseKeys);
    void connect(viewport)
      .then((next) => {
        peer = next;
        if (disposed) {
          next.close();
          return;
        }
        socket.current = next;
        setFeatures(next.browserFeatures ?? null);
        next.binaryType = "arraybuffer";
        const opened = () => setStatus("Browser view connected");
        next.addEventListener("open", opened);
        if (next.readyState === WebSocket.OPEN) opened();
        next.addEventListener("message", (event) => {
          if (disposed) return;
          if (typeof event.data === "string") {
            try {
              const message = decodeBrowserViewHostMessage(event.data);
              if (message?.type === "cursor") setCursor(message.cursor);
              else if (message?.type === "context-menu") setMenu(message);
              else if (message?.type === "copied" || message?.type === "copyTooLarge") {
                const pending = copy.current;
                copy.current = null;
                if (message.type === "copied") pending?.resolve(message.text);
                else pending?.reject(new Error("The page selection is too large to copy."));
              }
            } catch {
              next.close();
            }
            return;
          }
          if (!(event.data instanceof ArrayBuffer)) return;
          try {
            const frame = decodeBrowserViewFrame(new Uint8Array(event.data));
            sequence = frame.sequence;
            const url = URL.createObjectURL(
              new Blob([new Uint8Array(frame.image)], { type: "image/jpeg" }),
            );
            if (image.current) image.current.src = url;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = url;
          } catch {
            next.close();
          }
        });
        next.addEventListener("close", () => {
          copy.current?.reject(new Error("The browser view closed before copying."));
          copy.current = null;
          if (!disposed) setStatus("Browser view closed. Reconnect to continue.");
        });
        next.addEventListener("error", () => {
          if (!disposed) setStatus("Browser view unavailable. Check the host connection.");
        });
      })
      .catch(() => {
        if (!disposed) setStatus("Browser view unavailable. Check the host connection.");
      });
    return () => {
      disposed = true;
      copy.current?.reject(new Error("The browser view closed before copying."));
      copy.current = null;
      releaseKeys();
      peer?.close();
      socket.current = null;
      surface?.removeEventListener("wheel", wheel);
      surface?.removeEventListener("load", drawn);
      surface?.removeEventListener("error", failed);
      surface?.removeEventListener("blur", releaseKeys);
      surface?.removeEventListener("lostpointercapture", lostCapture);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", releaseKeys);
      surface?.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connect, viewport]);
  const send = (input: BrowserViewInput) => {
    if (control.current && socket.current?.readyState === WebSocket.OPEN) {
      if (socket.current.bufferedAmount >= 8192) {
        socket.current.close();
        return;
      }
      if (input.type === "pointer" && features?.framePoint) {
        if (drawnSequence.current === undefined) return;
        input = { ...input, sequence: drawnSequence.current };
      }
      socket.current.send(JSON.stringify(input));
    }
  };
  async function copySelection(cut = false) {
    if (
      !interactive ||
      !features?.clipboard ||
      copy.current ||
      socket.current?.readyState !== WebSocket.OPEN
    )
      return;
    const peer = socket.current;
    setCopying(true);
    const selection = Promise.withResolvers<string>();
    copy.current = selection;
    let selected = "";
    const text = selection.promise.then((value) => {
      selected = value;
      return value;
    });
    void text.catch(() => {});
    try {
      const write =
        typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
          ? navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })),
              }),
            ])
          : text.then((value) => navigator.clipboard.writeText(value));
      send({ type: "copy" });
      await write;
      if (cut && control.current && peer === socket.current) send({ type: "cut", text: selected });
      setStatus(cut ? "Selection cut to your clipboard" : "Selection copied to your clipboard");
    } catch {
      setStatus("Clipboard access failed. Check browser permissions and reconnect if needed.");
    }
    setCopying(false);
  }
  async function paste() {
    const peer = socket.current;
    try {
      const text = await navigator.clipboard.readText();
      if (control.current && peer === socket.current) send({ type: "paste", text });
    } catch {
      setStatus("Allow clipboard access to paste into the page.");
    }
  }
  return (
    <section aria-label="Browser page" className={source ? "browser-live-view" : "space-y-2"}>
      <p
        role="status"
        className={source ? "browser-live-status" : undefined}
        data-connected={source && status === "Browser view connected" ? "" : undefined}
      >
        {status}
        {source && status !== "Browser view connected" && (
          <button
            className="ui-button ui-button-variant-ghost ui-button-size-sm"
            onClick={onReconnect}
          >
            Reconnect
          </button>
        )}
      </p>

      {!source && (
        <>
          <p className="text-sm">
            Take control of the tab, then click the page to type, drag, or scroll. Tab moves focus
            out of the viewer.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!interactive}
            onClick={() => {
              send({
                type: "key",
                action: "down",
                key: "Tab",
                code: "Tab",
                text: "",
                modifiers: 0,
              });
              send({ type: "key", action: "up", key: "Tab", code: "Tab", text: "", modifiers: 0 });
            }}
          >
            Tab in page
          </Button>
          {features?.clipboard && (
            <div className="flex flex-wrap gap-2" aria-label="Page clipboard">
              <Button
                variant="outline"
                size="sm"
                disabled={!interactive || copying}
                onClick={() => void copySelection()}
              >
                Copy selection
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!interactive || copying}
                onClick={() => void copySelection(true)}
              >
                Cut selection
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!interactive}
                onClick={() => void paste()}
              >
                Paste clipboard
              </Button>
            </div>
          )}
        </>
      )}
      {menu && interactive && (
        <div
          role="group"
          aria-label="Page context menu"
          className={source ? "ui-action-menu browser-source-context-menu" : "flex flex-wrap gap-2"}
        >
          {menu.items.map((item) => (
            <Button
              key={item}
              variant="outline"
              size="sm"
              onClick={() => {
                if (item === "copy" || item === "cut") void copySelection(item === "cut");
                else if (item === "paste") void paste();
                else if (item === "select-all") {
                  send({
                    type: "key",
                    action: "down",
                    key: "a",
                    code: "KeyA",
                    text: "",
                    modifiers: features?.selectAllModifiers ?? 2,
                  });
                  send({
                    type: "key",
                    action: "up",
                    key: "a",
                    code: "KeyA",
                    text: "",
                    modifiers: 0,
                  });
                } else {
                  const text = item === "copy-link" ? menu.link : menu.image;
                  if (text)
                    void navigator.clipboard
                      .writeText(text)
                      .catch(() => setStatus("Clipboard access failed."));
                }
                setMenu(null);
              }}
            >
              {item.replaceAll("-", " ")}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => setMenu(null)}>
            Close page menu
          </Button>
        </div>
      )}
      <img
        ref={image}
        alt="Live browser page; focus to type and click to interact"
        tabIndex={0}
        className={source ? "browser-live-image" : "max-w-full focus:outline -outline-offset-2"}
        draggable={false}
        style={{ touchAction: "none", cursor }}
        onAuxClick={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
        onBlur={() => {
          for (const input of keyboard.current.release()) send(input);
        }}
        onPointerDown={(event) => {
          if (!interactive || event.button > 2) return;
          event.preventDefault();
          capture.current = event.pointerId;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          pressed.current = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left";
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "down",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current ?? "left",
            clickCount: Math.max(1, Math.min(3, event.detail)),
            deltaX: 0,
            deltaY: 0,
            modifiers:
              (event.altKey ? 1 : 0) |
              (event.ctrlKey ? 2 : 0) |
              (event.metaKey ? 4 : 0) |
              (event.shiftKey ? 8 : 0),
          });
        }}
        onPointerUp={(event) => {
          if (pressed.current === null) return;
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "up",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current ?? "left",
            clickCount: Math.max(1, Math.min(3, event.detail)),
            deltaX: 0,
            deltaY: 0,
            modifiers:
              (event.altKey ? 1 : 0) |
              (event.ctrlKey ? 2 : 0) |
              (event.metaKey ? 4 : 0) |
              (event.shiftKey ? 8 : 0),
          });
          pressed.current = null;
          capture.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pressed.current && !features?.cursor) return;
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "move",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current ?? "left",
            clickCount: Math.max(1, Math.min(3, event.detail)),
            deltaX: 0,
            deltaY: 0,
            modifiers:
              (event.altKey ? 1 : 0) |
              (event.ctrlKey ? 2 : 0) |
              (event.metaKey ? 4 : 0) |
              (event.shiftKey ? 8 : 0),
          });
        }}
        onPointerCancel={(event) => {
          if (!pressed.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "up",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current ?? "left",
            clickCount: Math.max(1, Math.min(3, event.detail)),
            deltaX: 0,
            deltaY: 0,
            modifiers:
              (event.altKey ? 1 : 0) |
              (event.ctrlKey ? 2 : 0) |
              (event.metaKey ? 4 : 0) |
              (event.shiftKey ? 8 : 0),
          });
          pressed.current = null;
        }}
        onKeyDown={(event) => {
          if (!interactive || event.key === "Tab") return;
          event.preventDefault();
          if (event.key === "Escape" && menu) {
            setMenu(null);
            return;
          }
          if (features?.clipboard && (event.ctrlKey || event.metaKey)) {
            const key = event.key.toLowerCase();
            if (key === "c" || key === "x") {
              void copySelection(key === "x");
              return;
            }
            if (key === "v") {
              void paste();
              return;
            }
          }
          const modifiers =
            (event.altKey ? 1 : 0) |
            (event.ctrlKey ? 2 : 0) |
            (event.metaKey ? 4 : 0) |
            (event.shiftKey ? 8 : 0);
          const inputs = keyboard.current.down({
            key: event.key,
            code: event.code,
            modifiers,
          });
          for (const input of inputs) send(input);
        }}
        onKeyUp={(event) => {
          if (event.key !== "Tab")
            for (const input of keyboard.current.up({
              key: event.key,
              code: event.code,
              modifiers:
                (event.altKey ? 1 : 0) |
                (event.ctrlKey ? 2 : 0) |
                (event.metaKey ? 4 : 0) |
                (event.shiftKey ? 8 : 0),
            }))
              send(input);
        }}
      />
    </section>
  );
}
