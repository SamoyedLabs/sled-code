import { useEffect, useRef, useState } from "react";
import { decodeBrowserViewFrame, type BrowserViewInput } from "@t3tools/contracts";
import { BrowserKeyboard } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";

// connect must create an authenticated Sled viewer grant and socket for this host/tab.
// No upstream endpoint or credential is accepted by this component.
export function BotBrowserView({ connect }: { connect: () => Promise<WebSocket> }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <section aria-label="Live bot browser">
      <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
        Reconnect viewer
      </Button>
      <BrowserStream key={attempt} connect={connect} />
    </section>
  );
}
function BrowserStream({ connect }: { connect: () => Promise<WebSocket> }) {
  const [status, setStatus] = useState("Connecting browser view…");
  const image = useRef<HTMLImageElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const pressed = useRef<"left" | "middle" | "right" | null>(null);
  const keyboard = useRef(new BrowserKeyboard());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the authenticated browser socket and image object URLs for this mounted viewer.
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    let peer: WebSocket | null = null;
    const surface = image.current;
    const keys = keyboard.current;
    const releaseKeys = () => {
      for (const input of keys.release())
        if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(input));
    };
    const wheel = (event: WheelEvent) => {
      if (!surface || peer?.readyState !== WebSocket.OPEN) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      peer.send(
        JSON.stringify({
          type: "pointer",
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
    void connect()
      .then((next) => {
        peer = next;
        if (disposed) {
          next.close();
          return;
        }
        socket.current = next;
        next.binaryType = "arraybuffer";
        const opened = () => setStatus("Browser view connected");
        next.addEventListener("open", opened);
        if (next.readyState === WebSocket.OPEN) opened();
        next.addEventListener("message", (event) => {
          if (disposed || !(event.data instanceof ArrayBuffer)) return;
          try {
            const frame = decodeBrowserViewFrame(new Uint8Array(event.data));
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
      releaseKeys();
      peer?.close();
      socket.current = null;
      surface?.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", releaseKeys);
      surface?.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connect]);
  const send = (input: BrowserViewInput) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(input));
  };
  return (
    <section aria-label="Browser page" className="space-y-2">
      <p role="status">{status}</p>

      <p className="text-sm">
        Take control of the tab, then click the page to type, drag, or scroll. Tab moves focus out
        of the viewer.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          send({ type: "key", action: "down", key: "Tab", code: "Tab", text: "", modifiers: 0 });
          send({ type: "key", action: "up", key: "Tab", code: "Tab", text: "", modifiers: 0 });
        }}
      >
        Tab in page
      </Button>
      <img
        ref={image}
        alt="Live browser page; focus to type and click to interact"
        tabIndex={0}
        className="max-w-full focus:outline -outline-offset-2"
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        onBlur={() => {
          for (const input of keyboard.current.release()) send(input);
        }}
        onPointerDown={(event) => {
          if (event.button > 2) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          pressed.current = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left";
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "down",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current,
            clickCount: 1,
            deltaX: 0,
            deltaY: 0,
            modifiers: 0,
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
            button: pressed.current,
            clickCount: 1,
            deltaX: 0,
            deltaY: 0,
            modifiers: 0,
          });
          pressed.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pressed.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          send({
            type: "pointer",
            action: "move",
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            button: pressed.current,
            clickCount: 1,
            deltaX: 0,
            deltaY: 0,
            modifiers: 0,
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
            button: pressed.current,
            clickCount: 1,
            deltaX: 0,
            deltaY: 0,
            modifiers: 0,
          });
          pressed.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") return;
          event.preventDefault();
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
