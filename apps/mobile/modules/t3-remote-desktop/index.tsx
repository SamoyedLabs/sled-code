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
  refreshPickerPreview?(): Promise<void>;
  recordAcceptanceEvent(json: string): Promise<void>;
}
interface RemoteDesktopProps extends ViewProps {
  readonly appearance?: "light" | "dark";
  readonly ref?: Ref<RemoteDesktopHandle>;
  readonly onNativeState?: (
    event: NativeSyntheticEvent<{
      readonly state:
        | "connected"
        | "connecting"
        | "closed"
        | "stopRequested"
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

// The native view owns reception, HEVC decoding, display and input.
export const RemoteDesktopView = requireNativeView<RemoteDesktopProps>("T3RemoteDesktop");
const nativeModule = requireNativeModule<{
  acceptanceEnabled: boolean;
  getPickerPreview?(fingerprint: string): Promise<string | null>;
}>("T3RemoteDesktop");
export const remoteDesktopAcceptanceEnabled = nativeModule.acceptanceEnabled;
export const getRemoteDesktopPreview = (fingerprint: string) =>
  nativeModule.getPickerPreview?.(fingerprint) ?? Promise.resolve(null);
