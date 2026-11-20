import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { browserViewerConnection } from "@t3tools/client-runtime/openbot/presentation";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AtomRegistry } from "effect/reactivity";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";

export function useBotBrowserConnection(environmentId: EnvironmentId, hostId: string) {
  const registry = useContext(RegistryContext);
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  return async (tabId: string, viewport?: { width: number; height: number }) => {
    if (Option.isNone(prepared))
      throw new Error("Connect to this environment before opening its browser.");
    const accessAtom = openbot.browserViewAccess({ environmentId, input: {} });
    registry.refresh(accessAtom);
    const access = await Effect.runPromise(
      AtomRegistry.getResult(registry, accessAtom, { suspendOnWaiting: true }).pipe(
        Effect.timeout("10 seconds"),
      ),
    );
    const options = { reportFailure: false, reportDefect: false };
    const opened = await runAtomCommand(
      registry,
      openbot.browserViewCommand,
      {
        environmentId,
        input: {
          operation: "open",
          hostId,
          tabId,
          ackFrames: true,
          advanced: true,
          ...(viewport ? { viewport } : {}),
        },
      },
      options,
    );
    if (opened._tag === "Failure" || !opened.value)
      throw new Error("The browser viewer could not connect.");
    const grant = opened.value;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await runAtomCommand(
        registry,
        openbot.browserViewCommand,
        { environmentId, input: { operation: "close", hostId, id: grant.id } },
        options,
      );
    };
    const featureProperties = grant.features ? { browserFeatures: grant.features } : {};
    try {
      const target = browserViewerConnection(access, grant, { hostId, tabId }, Date.now());
      const socket = new WebSocket(target.url, [target.protocol]);
      socket.addEventListener(
        "close",
        () => {
          void release();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          socket.close();
          void release();
        },
        { once: true },
      );
      return Object.assign(socket, featureProperties);
    } catch {
      await release();
      throw new Error("The browser viewer could not connect.");
    }
  };
}

export function useBotBrowserViewer(environmentId: EnvironmentId, hostId: string, tabId: string) {
  const connect = useBotBrowserConnection(environmentId, hostId);
  return (viewport?: { width: number; height: number }) => connect(tabId, viewport);
}
