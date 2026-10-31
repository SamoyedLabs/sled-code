import { requireNativeModule, requireNativeView } from "expo";
import type { ViewProps } from "react-native";
import type { NativeSyntheticEvent } from "react-native";
import type { Ref } from "react";
import type { RemoteDesktopStartInput, RemoteDesktopRestartInput } from "@t3tools/contracts";

export interface RemoteDesktopHandle {
  createNativeOffer(fingerprint: string): Promise<RemoteDesktopStartInput>;
  createConfiguredNativeOffer(
    fingerprint: string,
    connectivityJson: string,
  ): Promise<RemoteDesktopStartInput>;
  acceptNativeAnswer(json: string): Promise<void>;
  createNativeRestartOffer(connectivityJson: string): Promise<RemoteDesktopRestartInput>;
  closeNativeSession(): Promise<void>;
  recordAcceptanceEvent(json: string): Promise<void>;
}
interface RemoteDesktopProps extends ViewProps {
  readonly ref?: Ref<RemoteDesktopHandle>;
  readonly onNativeState?: (
    event: NativeSyntheticEvent<{
      readonly state:
        | "connected"
        | "connecting"
        | "closed"
        | "path"
        | "network"
        | "needsRestart"
        | "degraded"
        | "recovered";
      readonly available?: boolean;
      readonly path?: "direct" | "relayed";
      readonly relayProtocol?: string;
    }>,
  ) => void;
}

// The native view owns reception, HEVC decoding, display and input. No frames
// or high-frequency pointer events cross the JavaScript bridge.
export const RemoteDesktopView = requireNativeView<RemoteDesktopProps>("T3RemoteDesktop");
export const remoteDesktopAcceptanceEnabled = requireNativeModule<{ acceptanceEnabled: boolean }>(
  "T3RemoteDesktop",
).acceptanceEnabled;
