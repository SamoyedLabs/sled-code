/* oxlint-disable shadcn/no-unknown-classes -- Original SettingsMobileConnectTab selectors are supplied by source CSS. */
import { useRef, useState, type ReactNode } from "react";
import { Link2, Plus, Scan, Smartphone } from "lucide-react";
import { confirmed } from "../../../settings/BotConnectionControls";
import { SettingsSection, SourceButton } from "./SettingsParts";
import "./settings-mobile-connect.css";

export interface MobileConnectedDevice {
  sessionId: string;
  name: string;
  platform?: "ios" | "android" | "unknown";
  via: "link" | "code" | "session";
  lastActiveAt: number;
}
export function SettingsMobileConnect({
  devices,
  loading = false,
  error,
  route,
  link,
  dialogs,
  onAddPhone,
  onDisconnect,
}: {
  devices: readonly MobileConnectedDevice[] | null;
  loading?: boolean;
  error?: string | null;
  route?: ReactNode;
  link?: ReactNode;
  dialogs?: ReactNode;
  onAddPhone?: () => void;
  onDisconnect?: (sessionId: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const lock = useRef(false);
  const disconnect = async (device: MobileConnectedDevice) => {
    if (lock.current || !onDisconnect || !(await confirmed(`Disconnect ${device.name}?`))) return;
    lock.current = true;
    setRevoking(device.sessionId);
    setFailure(null);
    try {
      await onDisconnect(device.sessionId);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "The phone could not be disconnected.");
    } finally {
      lock.current = false;
      setRevoking(null);
    }
  };
  const add = (
    <SourceButton variant="default" disabled={!onAddPhone} onClick={onAddPhone}>
      <Plus aria-hidden="true" />
      Add phone
    </SourceButton>
  );
  return (
    <SettingsSection
      title="Your phones"
      description="Phones that use OpenBot with this account."
      actions={
        <>
          {loading && (
            <span className="ui-text" data-variant="caption" data-tone="muted" role="status">
              Refreshing…
            </span>
          )}
          {route}
          {devices && devices.length > 0 && add}
        </>
      }
    >
      <div className="settings-mobile-phones">
        {devices?.length === 0 && (
          <div className="settings-mobile-phones-empty">
            <span className="settings-mobile-phones-empty-icon" aria-hidden="true">
              <Smartphone />
            </span>
            <p className="ui-text settings-mobile-phones-empty-title" data-variant="body">
              No phones yet
            </p>
            <p className="ui-text" data-variant="caption" data-tone="muted">
              Chat with your agents and follow their work from your phone.
            </p>
            {add}
          </div>
        )}
        {devices?.map((device) => (
          <div key={device.sessionId} className="settings-mobile-phone-card">
            <span className="settings-mobile-phone-icon">
              <Smartphone aria-hidden="true" />
            </span>
            <div className="settings-mobile-phone-copy">
              <p className="ui-text settings-mobile-phone-name" data-variant="body-sm">
                {device.name}
              </p>
              <p className="ui-text" data-variant="caption" data-tone="muted">
                {device.platform === "ios"
                  ? "iOS"
                  : device.platform === "android"
                    ? "Android"
                    : "Mobile"}{" "}
                · Last active {new Date(device.lastActiveAt).toLocaleString()}
              </p>
              <span className="settings-mobile-phone-via">
                {device.via === "link" ? <Link2 aria-hidden="true" /> : <Scan aria-hidden="true" />}
                {device.via === "session"
                  ? "Connected securely"
                  : device.via === "link"
                    ? "Signed in with a link"
                    : "Signed in with a code"}
              </span>
            </div>
            <SourceButton
              variant="destructive-ghost"
              size="xs"
              disabled={!onDisconnect || revoking !== null}
              aria-label={`Disconnect ${device.name}`}
              onClick={() => void disconnect(device)}
            >
              {revoking === device.sessionId ? "Disconnecting…" : "Disconnect"}
            </SourceButton>
          </div>
        ))}
        {link}
      </div>
      {(error || failure) && (
        <p className="settings-modal-error" role="alert">
          {failure ?? error}
        </p>
      )}
      {dialogs}
    </SettingsSection>
  );
}
