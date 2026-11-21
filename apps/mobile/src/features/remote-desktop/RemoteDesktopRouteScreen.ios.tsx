import { useGT } from "gt-react-native";
import {
  RemoteDesktopView,
  getRemoteDesktopPreview,
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
import { AppState, View } from "react-native";
import type { EnvironmentId, RemoteDesktopStatus } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { AppText } from "../../components/ui/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { useConnectionController } from "../connection/useConnectionController";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { remoteDesktopCommands } from "./remoteDesktopCommands";
import { RemoteDesktopSession } from "./RemoteDesktopSession";
import {
  RemoteDesktopComputerPicker,
  type RemoteDesktopPickerComputer,
} from "./RemoteDesktopComputerPicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function value<A, E>(result: AtomCommandResult<A, E>): A {
  if (AsyncResult.isSuccess(result)) return result.value;
  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
  throw new Error("Remote desktop request did not complete");
}

const idleSnapshot: ReturnType<RemoteDesktopSession["snapshot"]> = {
  phase: "idle",
  environmentId: null,
  host: "",
  path: null,
  error: null,
};
const snapshotIdle = () => idleSnapshot;
const subscribeIdle = () => () => {};

type ReadinessState =
  | "ready"
  | "unavailable"
  | "permissions"
  | "disabled"
  | "unauthorized"
  | "error";

interface ComputerCheck {
  readonly state: ReadinessState;
  readonly fingerprint?: string | undefined;
  readonly preview?: string | undefined;
}

async function probeComputerReadiness(
  id: EnvironmentId,
  fetchStatus: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: Record<string, never>;
  }) => Promise<AtomCommandResult<RemoteDesktopStatus, unknown>>,
): Promise<{ readonly check: ComputerCheck; readonly cacheable: boolean }> {
  try {
    const status = value(await fetchStatus({ environmentId: id, input: {} }));
    const nextState = readiness(status);
    return {
      check: {
        state: nextState,
        fingerprint: nextState === "ready" ? (status.hostFingerprint ?? undefined) : undefined,
      },
      cacheable: true,
    };
  } catch (error) {
    return {
      check: {
        state:
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "EnvironmentAuthorizationError"
            ? "unauthorized"
            : "error",
      },
      cacheable: false,
    };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function RemoteDesktopRouteScreen() {
  const gt = useGT();
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
  const pickerGeneration = useRef(0);
  const connections = useConnectionController();
  const { colorScheme } = useControlTheme();
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
  const rpcRef = useRef({ status, start, renew, restart, stop });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The imperative session reads the current registry-bound RPC callbacks after commit.
  useEffect(() => {
    rpcRef.current = { status, start, renew, restart, stop };
  }, [status, start, renew, restart, stop]);
  const [session, setSession] = useState<RemoteDesktopSession | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the native session and app-background subscription for this mounted route.
  useEffect(() => {
    const owner = new RemoteDesktopSession({
      signalingReady: (environmentId) =>
        connectionsRef.current.connectedEnvironments.some(
          (entry) =>
            entry.environmentId === environmentId &&
            entry.isEnabled &&
            entry.connectionState === "connected",
        ),
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
        status: async (environmentId) =>
          value(await rpcRef.current.status({ environmentId, input: {} })),
        start: async (environmentId, input) =>
          value(await rpcRef.current.start({ environmentId, input })),
        renew: async (environmentId, input) =>
          value(await rpcRef.current.renew({ environmentId, input })),
        restart: async (environmentId, input) =>
          value(await rpcRef.current.restart({ environmentId, input })),
        stop: async (environmentId, input) => {
          value(await rpcRef.current.stop({ environmentId, input }));
        },
      },
    });
    setSession(owner);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        pickerGeneration.current++;
        owner.stop();
      }
    });
    return () => {
      subscription.remove();
      owner.stop();
    };
  }, []);
  const state = useSyncExternalStore(
    session?.subscribe ?? subscribeIdle,
    session?.snapshot ?? snapshotIdle,
  );
  const [pickerOpen, setPickerOpen] = useState(true);
  const closePicker = useCallback(() => {
    pickerGeneration.current++;
    setPickerOpen(false);
  }, []);
  const [refreshing, setRefreshing] = useState<EnvironmentId | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReadonlyMap<EnvironmentId, ComputerCheck>>(new Map());
  const cache = useRef(new Map<EnvironmentId, ComputerCheck & { checkedAt: number }>());
  const current = state.environmentId ?? undefined;
  const savedIds = new Set(connections.connectedEnvironments.map((entry) => entry.environmentId));
  const labels = connections.connectedEnvironments.map((entry) => entry.environmentLabel);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Probe capabilities only while opening the picker, with bounded concurrent RPCs.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    const previewRefresh = native.current?.refreshPickerPreview?.().catch(() => undefined);
    const eligible = connectionsRef.current.connectedEnvironments.filter(
      (entry) => entry.isEnabled && entry.connectionState === "connected",
    );
    const readNext = async () => {
      for (let entry = eligible.shift(); entry; entry = eligible.shift()) {
        if (cancelled) return;
        const id = entry.environmentId;
        const previous = cache.current.get(id);
        let check: ComputerCheck;
        if (previous && Date.now() - previous.checkedAt < 10_000) {
          check = previous;
        } else {
          const probed = await probeComputerReadiness(id, rpcRef.current.status);
          check = probed.check;
          if (!cancelled && probed.cacheable) {
            cache.current.set(id, { ...check, checkedAt: Date.now() });
          }
        }
        if (cancelled) return;
        setChecks((old) => {
          const last = old.get(id);
          return new Map(old).set(id, {
            ...check,
            preview: last?.fingerprint === check.fingerprint ? last?.preview : undefined,
          });
        });
        if (check.fingerprint) {
          await previewRefresh;
          const preview = await getRemoteDesktopPreview(check.fingerprint).catch(() => null);
          if (!cancelled && preview)
            setChecks((old) => new Map(old).set(id, { ...check, preview }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(eligible.length, 4) }, readNext));
    return () => {
      cancelled = true;
    };
  }, [pickerOpen]);

  const chooseHost = useCallback(() => {
    const connections = connectionsRef.current;
    pickerGeneration.current++;
    setPickerError(null);
    setPickerOpen(true);
    if (!connections.relayDiscovery.isRefreshing) void connections.refreshRelayEnvironments();
  }, []);
  useFocusEffect(
    useCallback(() => {
      chooseHost();
      return closePicker;
    }, [chooseHost, closePicker]),
  );

  const readinessLabel = (readinessState: ReadinessState | undefined): string => {
    switch (readinessState) {
      case "ready":
        return gt("Ready");
      case "unavailable":
        return gt("Remote Desktop unavailable");
      case "permissions":
        return gt("Screen recording or accessibility permission required");
      case "disabled":
        return gt("Enable Remote Desktop on this computer");
      case "unauthorized":
        return gt("Remote Desktop access required");
      case "error":
        return gt("Could not check Remote Desktop");
      case undefined:
        return gt("Remote Desktop status unchecked");
    }
  };

  const computers: RemoteDesktopPickerComputer[] = connections.connectedEnvironments.map(
    (entry) => {
      const id = entry.environmentId;
      const selected = current === id;
      const connection = entry.connectionState;
      const check = checks.get(id);
      const checkState = check?.state;
      const isConnecting = connection === "connecting" || connection === "reconnecting";
      const label = !entry.isEnabled
        ? gt("Disabled on this device")
        : connection === "connected"
          ? readinessLabel(checkState)
          : isConnecting
            ? gt("Connecting to Sled")
            : gt("Offline");
      const action =
        refreshing === id
          ? undefined
          : selected
            ? "select"
            : !entry.isEnabled
              ? "enable"
              : connection !== "connected"
                ? isConnecting
                  ? undefined
                  : "reconnect"
                : checkState === "unauthorized" && entry.isRelayManaged
                  ? "refreshAccess"
                  : checkState === "ready" || checkState === undefined || checkState === "error"
                    ? "connect"
                    : undefined;
      return {
        id,
        name: entry.environmentLabel,
        preview: checkState === "ready" ? check?.preview : undefined,
        detail:
          labels.filter((existing) => existing === entry.environmentLabel).length > 1
            ? connectionAddress(entry.displayUrl)
            : undefined,
        section:
          !selected &&
          (!entry.isEnabled ||
            checkState === "unauthorized" ||
            checkState === "disabled" ||
            checkState === "permissions")
            ? "setup"
            : entry.isRelayManaged
              ? "sled"
              : "saved",
        status:
          refreshing === id
            ? gt("Refreshing Sled Connect access…")
            : selected
              ? gt("Current computer / {status}", {
                  status: state.phase === "connected" ? gt("Connected") : label,
                })
              : label,
        action,
        selected,
        busy: refreshing === id || (entry.isEnabled && isConnecting),
        onPress: async () => {
          if (!entry.isEnabled) {
            void connections.setEnvironmentEnabled(id, true);
            return;
          }
          if (connection !== "connected") {
            void connections.retryEnvironment(id);
            return;
          }
          if (checkState === "unauthorized" && entry.isRelayManaged) {
            const generation = pickerGeneration.current;
            setRefreshing(id);
            setPickerError(null);
            const fallbackError = gt("Couldn't refresh Sled Connect access.");
            let refreshed = false;
            try {
              value(await connections.refreshRelayAccess(id));
              refreshed = true;
            } catch (error) {
              if (generation === pickerGeneration.current) {
                setPickerError(errorMessage(error, fallbackError));
              }
            }
            setRefreshing(null);
            if (refreshed && generation === pickerGeneration.current) {
              cache.current.delete(id);
              closePicker();
              void session?.connect({ environmentId: id, label: entry.environmentLabel });
            }
            return;
          }
          closePicker();
          if (!selected)
            void session?.connect({ environmentId: id, label: entry.environmentLabel });
        },
      };
    },
  );
  for (const { environment, availability, status } of connections.relayEnvironments) {
    if (savedIds.has(environment.environmentId) || availability === "offline") continue;
    computers.push({
      id: environment.environmentId,
      name: environment.label,
      section: "sled",
      machine: status?.descriptor?.platform.machine,
      status:
        availability === "online"
          ? gt("Available on Sled Connect")
          : availability === "checking"
            ? gt("Checking Sled Connect")
            : gt("Could not check connection"),
      action: availability === "online" ? "enable" : undefined,
      busy: availability === "checking",
      onPress: () => {
        void connections.connectRelayEnvironment(environment);
      },
    });
  }

  const error = state.error;
  const inlinePicker = pickerOpen && state.phase === "idle";
  const pathSuffix = state.path
    ? ` · ${state.path === "direct" ? gt("Direct") : gt("Relayed")}`
    : "";
  const headerStatus =
    state.phase === "idle"
      ? gt("Your computers")
      : state.phase === "connected"
        ? gt("Connected to {host}{path}", { host: state.host, path: pathSuffix })
        : state.phase === "recovering"
          ? gt("Reconnecting to {host}{path}", { host: state.host, path: pathSuffix })
          : gt("Connecting to {host}{path}", { host: state.host, path: pathSuffix });
  return (
    <View className="flex-1 bg-screen">
      <View
        className="flex-1"
        accessibilityElementsHidden={inlinePicker}
        pointerEvents={inlinePicker ? "none" : "auto"}
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="gap-2 border-b border-border px-4 py-3">
          <View className="flex-row items-center justify-between gap-3">
            <IconButton
              icon="chevron.left"
              accessibilityLabel={gt("Back")}
              onPress={() => {
                session?.stop();
                chooseHost();
              }}
            />
            <AppText className="min-w-0 flex-1" textRole="footnote">
              {headerStatus}
            </AppText>
            <Button
              label={state.phase === "idle" ? gt("Connect to computer") : gt("Switch computer")}
              size="compact"
              disabled={session === null}
              tone="secondary"
              onPress={chooseHost}
            />
          </View>
          {error ? (
            <AppText
              textRole="footnote"
              accessibilityRole="alert"
              className="text-foreground-muted"
            >
              {error}
            </AppText>
          ) : null}
        </View>
        <RemoteDesktopView
          ref={native}
          appearance={colorScheme}
          style={{ flex: 1 }}
          pointerEvents={
            state.phase === "connecting" || state.phase === "recovering" ? "none" : "auto"
          }
          onNativeState={(event) => session?.nativeState(event.nativeEvent)}
        />
      </View>
      <RemoteDesktopComputerPicker
        visible={pickerOpen}
        inline={state.phase === "idle"}
        title={current ? gt("Switch computer") : gt("Computers")}
        computers={computers}
        emptyMessage={
          connections.relayDiscovery.isRefreshing
            ? gt("Finding computers on Sled Connect...")
            : gt("Use Add computer to find computers on Sled Connect or add one manually.")
        }
        discoveryError={connections.relayDiscovery.error}
        selectionError={pickerError}
        onClose={() => {
          if (state.phase !== "idle") {
            closePicker();
            return;
          }
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate("Home");
        }}
        onAddComputer={() => {
          if (!inlinePicker) closePicker();
          navigation.navigate("SettingsEnvironmentNew");
        }}
        onDisconnect={
          current
            ? () => {
                closePicker();
                session?.stop();
              }
            : undefined
        }
      />
    </View>
  );
}

function readiness(status: RemoteDesktopStatus): ReadinessState {
  if (!status.available) return "unavailable";
  if (
    status.permissions &&
    (!status.permissions.screenRecording || !status.permissions.accessibility)
  ) {
    return "permissions";
  }
  if (
    !status.enabled ||
    !status.remoteEnabled ||
    !status.internetEnabled ||
    !status.hostFingerprint
  ) {
    return "disabled";
  }
  return "ready";
}

function connectionAddress(address: string) {
  try {
    return new URL(address).host || undefined;
  } catch {
    return undefined;
  }
}
