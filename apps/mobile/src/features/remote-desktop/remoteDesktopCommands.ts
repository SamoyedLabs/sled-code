import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";

// The same destination-aware permission guard as terminal and other T3 commands.
export const remoteDesktopCommands = {
  restart: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:remote-desktop:restart",
    tag: WS_METHODS.remoteDesktopRestart,
  }),
  status: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:remote-desktop:status",
    tag: WS_METHODS.remoteDesktopStatus,
  }),
  start: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:remote-desktop:start",
    tag: WS_METHODS.remoteDesktopStart,
  }),
  renew: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:remote-desktop:renew",
    tag: WS_METHODS.remoteDesktopRenew,
  }),
  stop: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:remote-desktop:stop",
    tag: WS_METHODS.remoteDesktopStop,
  }),
};
