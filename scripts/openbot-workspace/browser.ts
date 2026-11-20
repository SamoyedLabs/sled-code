import type { BrowserLiveViewEvent } from "@openbot/contracts/ipc";
import {
  browserViewInputForHost,
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  decodeBrowserViewInputValue,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { WebWorkspaceRuntime } from "../src/renderer/src/features/web-client/web-runtime";

export function createSledBrowser(
  call: (method: string, args: unknown) => Promise<unknown>,
  host: () => string | null,
) {
  const listeners = new Set<(event: BrowserLiveViewEvent) => void>();
  let view: {
    id: string;
    tabId: string;
    hostId: string;
    framePoint: boolean;
    clipboard: boolean;
  } | null = null;
  const emit = (event: BrowserLiveViewEvent) => {
    for (const listener of listeners) listener(event);
  };
  const stop = async () => {
    const current = view;
    view = null;
    if (current) await call("browser-close", { id: current.id, hostId: current.hostId });
  };
  const browser: WebWorkspaceRuntime["browser"] = {
    async startLiveView(tabId) {
      await stop();
      const hostId = host();
      if (!hostId) throw new Error("Select a connected Sled environment");
      const current = {
        id: crypto.randomUUID(),
        tabId,
        hostId,
        framePoint: false,
        clipboard: false,
      };
      view = current;
      try {
        const features = await call("browser-open", { id: current.id, hostId, tabId });
        if (view !== current) {
          await call("browser-close", { id: current.id, hostId });
          throw new Error("The browser view changed while opening");
        }
        if (isDynamicRecord(features)) {
          current.framePoint = features.framePoint === true;
          current.clipboard = features.clipboard === true;
        }
      } catch (error) {
        if (view === current) view = null;
        throw error;
      }
    },
    stopLiveView: stop,
    async sendLiveViewInput(input) {
      const current = view;
      if (!current) throw new Error("The browser view is not connected");
      const wire = browserViewInputForHost(
        decodeBrowserViewInputValue(input),
        current.framePoint,
        current.clipboard,
      );
      if (wire)
        await call("browser-input", { id: current.id, hostId: current.hostId, input: wire });
    },
    onLiveViewEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    browser,
    activeTabId: () => view?.tabId ?? null,
    stop,
    receive(value: unknown) {
      const current = view;
      if (!current || !isDynamicRecord(value) || value.id !== current.id) return;
      if (value.type === "closed") {
        view = null;
        emit({
          type: "stopped",
          tabId: current.tabId,
          reason: "The browser view closed. Reopen to continue.",
        });
        return;
      }
      if (value.type !== "data") return;
      try {
        if (value.data instanceof ArrayBuffer) {
          const frame = decodeBrowserViewFrame(new Uint8Array(value.data));
          emit({ type: "frame", tabId: current.tabId, ...frame });
        } else if (typeof value.data === "string") {
          const message = decodeBrowserViewHostMessage(value.data);
          if (message?.type === "copied" || message?.type === "copyTooLarge")
            emit({ ...message, tabId: current.tabId });
        }
      } catch {
        void stop().catch(() => undefined);
        emit({
          type: "stopped",
          tabId: current.tabId,
          reason: "The browser sent an invalid frame.",
        });
      }
    },
  };
}
