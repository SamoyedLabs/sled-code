import { useEffectEvent, useRef } from "react";
import { decodeBrowserViewInput, type EnvironmentId } from "@t3tools/contracts";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { useBotBrowserConnection } from "../../settings/useBotBrowserViewer";

export function useWorkspaceBrowser(environmentId: EnvironmentId, hostId: string) {
  const connect = useBotBrowserConnection(environmentId, hostId);
  const generation = useRef(0);
  const owned = useRef<{ id: string; socket: WebSocket } | null>(null);
  const stop = useStableCallback(() => {
    generation.current++;
    owned.current?.socket.close();
    owned.current = null;
  });
  const handle = useEffectEvent(
    async (
      method: string,
      args: Record<string, unknown>,
      emit: (value: { id: string; type: "data" | "closed"; data?: string | ArrayBuffer }) => void,
    ) => {
      if (typeof args.id !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(args.id))
        throw new Error("Invalid browser view identity");
      const id = args.id;
      if (method === "browser-open") {
        if (typeof args.tabId !== "string" || !args.tabId || args.tabId.length > 128)
          throw new Error("Invalid browser tab");
        stop();
        const current = generation.current;
        const socket = await connect(args.tabId);
        if (current !== generation.current) {
          socket.close();
          throw new Error("The browser view changed while opening");
        }
        owned.current = { id, socket };
        socket.binaryType = "arraybuffer";
        socket.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
          if (owned.current?.socket !== socket) return;
          if (typeof data === "string" || data instanceof ArrayBuffer)
            emit({ id, type: "data", data });
        });
        socket.addEventListener("close", () => {
          if (owned.current?.socket !== socket) return;
          owned.current = null;
          emit({ id, type: "closed" });
        });
        await new Promise<void>((resolve, reject) => {
          if (socket.readyState === WebSocket.OPEN) return resolve();
          const cleanup = () => {
            clearTimeout(timer);
            socket.removeEventListener("open", opened);
            socket.removeEventListener("close", failed);
            socket.removeEventListener("error", failed);
          };
          const opened = () => {
            cleanup();
            resolve();
          };
          const failed = () => {
            cleanup();
            socket.close();
            reject(new Error("The browser viewer could not connect"));
          };
          const timer = setTimeout(failed, 10_000);
          socket.addEventListener("open", opened, { once: true });
          socket.addEventListener("close", failed, { once: true });
          socket.addEventListener("error", failed, { once: true });
        });
        return socket.browserFeatures ?? null;
      }
      if (method === "browser-close") {
        if (owned.current?.id === id) stop();
        return null;
      }
      const view = owned.current;
      if (view?.id !== id || view.socket.readyState !== WebSocket.OPEN)
        throw new Error("This browser view is no longer connected");
      if (method !== "browser-input") throw new Error("Unsupported browser viewer action");
      view.socket.send(JSON.stringify(decodeBrowserViewInput(JSON.stringify(args.input))));
      return null;
    },
  );
  return { handle, close: stop };
}
