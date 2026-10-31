import type { EnvironmentId } from "@t3tools/contracts";
import {
  RemoteDesktopView,
  remoteDesktopAcceptanceEnabled,
  type RemoteDesktopHandle,
} from "@t3tools/mobile-remote-desktop-native";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ActionSheetIOS, AppState, View } from "react-native";
import { AsyncResult } from "effect/reactivity";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { AppText } from "../../components/ui/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { remoteDesktopCommands } from "./remoteDesktopCommands";
import { RemoteDesktopSession } from "./RemoteDesktopSession";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function value<A, E>(result: AtomCommandResult<A, E>): A {
  if (AsyncResult.isSuccess(result)) return result.value;
  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
  throw new Error("Remote desktop request did not complete");
}

export function RemoteDesktopRouteScreen() {
  useFocusEffect(
    useCallback(() => {
      const activation = activateKeepAwakeAsync("t3-remote-desktop");
      void activation.catch(() => {});
      return () => {
        void activation.then(() => deactivateKeepAwake("t3-remote-desktop")).catch(() => {});
      };
    }, []),
  );
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const native = useRef<RemoteDesktopHandle | null>(null);
  const connections = useRemoteConnections();
  const connectionsRef = useRef(connections);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the route-owned imperative session callbacks synchronized with the connection registry.
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);
  const status = useAtomCommand(remoteDesktopCommands.status, {
    reportFailure: false,
    reportDefect: false,
  });
  const start = useAtomCommand(remoteDesktopCommands.start, {
    reportFailure: false,
    reportDefect: false,
  });
  const renew = useAtomCommand(remoteDesktopCommands.renew, {
    reportFailure: false,
    reportDefect: false,
  });
  const restart = useAtomCommand(remoteDesktopCommands.restart, {
    reportFailure: false,
    reportDefect: false,
  });
  const stop = useAtomCommand(remoteDesktopCommands.stop, {
    reportFailure: false,
    reportDefect: false,
  });
  const signalingReady = useCallback(
    (environmentId: EnvironmentId) =>
      connectionsRef.current.connectedEnvironments.some(
        (entry) =>
          entry.environmentId === environmentId &&
          entry.isEnabled &&
          entry.connectionState === "connected",
      ),
    [],
  );
  // The RPC commands share the application's registry; this owner lives exactly
  // as long as the mounted route and reads the current native view through its ref.
  const [session] = useState(
    // oxlint-disable-next-line react/refs -- The constructor stores callbacks; ref reads occur later during native events and RPC recovery, never during render.
    () =>
      new RemoteDesktopSession({
        signalingReady,
        ...(remoteDesktopAcceptanceEnabled
          ? {
              trace: (environmentId, event) => {
                const connection = connectionsRef.current.connectedEnvironments.find(
                  (entry) => entry.environmentId === environmentId,
                );
                void native.current
                  ?.recordAcceptanceEvent(
                    JSON.stringify({
                      ...event,
                      connectionState: connection?.connectionState ?? "missing",
                    }),
                  )
                  .catch(() => {});
              },
            }
          : {}),
        native: () => native.current,
        rpc: {
          status: async (environmentId) => value(await status({ environmentId, input: {} })),
          start: async (environmentId, input) => value(await start({ environmentId, input })),
          renew: async (environmentId, input) => value(await renew({ environmentId, input })),
          restart: async (environmentId, input) => value(await restart({ environmentId, input })),
          stop: async (environmentId, input) => {
            value(await stop({ environmentId, input }));
          },
        },
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Route lifetime and app backgrounding revoke the external native session and all recovery work.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") session.stop();
    });
    return () => {
      subscription.remove();
      session.stop();
    };
  }, [session]);

  const chooseHost = () => {
    const hosts = connections.connectedEnvironments.filter(
      (entry) => entry.isEnabled && entry.connectionState === "connected",
    );
    if (hosts.length === 0) {
      setSelectionError(
        "Connect your development Mac to T3 Code first. You can pair a nearby Mac below.",
      );
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Development Macs",
        options: ["Cancel", ...hosts.map((entry) => entry.environmentLabel)],
        cancelButtonIndex: 0,
      },
      (index) => {
        const host = hosts[index - 1];
        if (host) {
          setSelectionError(null);
          void session.connect({ environmentId: host.environmentId, label: host.environmentLabel });
        }
      },
    );
  };
  const error = selectionError ?? state.error;
  return (
    <View
      className="flex-1 bg-screen"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="gap-2 border-b border-border px-4 py-3">
        <View className="flex-row items-center justify-between gap-3">
          <IconButton
            icon="chevron.left"
            accessibilityLabel="Back"
            onPress={() => {
              session.stop();
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate("Home");
            }}
          />
          <AppText className="min-w-0 flex-1" textRole="footnote">
            {state.phase === "idle"
              ? "Your development Macs"
              : `${state.phase === "connected" ? "Connected to" : state.phase === "recovering" ? "Reconnecting to" : "Connecting to"} ${state.host}${state.path ? ` · ${state.path === "direct" ? "Direct" : "Relayed"}` : ""}`}
          </AppText>
          <Button
            label={state.phase === "idle" ? "Connect to Mac" : "Disconnect"}
            tone="secondary"
            onPress={state.phase === "idle" ? chooseHost : session.stop}
          />
        </View>
        {error ? (
          <AppText textRole="footnote" accessibilityRole="alert" className="text-foreground-muted">
            {error}
          </AppText>
        ) : null}
      </View>
      <RemoteDesktopView
        ref={native}
        style={{ flex: 1 }}
        pointerEvents={
          state.phase === "connecting" || state.phase === "recovering" ? "none" : "auto"
        }
        onNativeState={(event) => session.nativeState(event.nativeEvent)}
      />
    </View>
  );
}
