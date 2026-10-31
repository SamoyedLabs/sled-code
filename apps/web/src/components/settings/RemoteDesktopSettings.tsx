// @effect-diagnostics globalTimers:off -- Polling exists only while this native host settings panel is mounted.
import { useEffect, useState } from "react";
import type { DesktopRemoteDesktopCommand } from "@t3tools/contracts";
import { useEnvironmentQuery } from "~/state/query";
import { desktopRemoteDesktopAtom, refreshRemoteDesktop } from "~/state/desktopRemoteDesktop";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { AdvancedSettings } from "./AdvancedSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const sharing = [
  ["clipboard", "Clipboard sharing", "Copy and paste between your Mac and paired devices."],
  ["audio", "Mac audio", "Play your Mac’s audio on the connected device."],
  [
    "virtual-display",
    "Virtual displays",
    "Give streamed windows their own display and resolution.",
  ],
] as const;
const networking = [
  ["remote", "Remote connections", "Allow trusted devices to connect by network address."],
  [
    "internet",
    "Internet access",
    "Connect from outside your local network using your paired T3 connection.",
  ],
  [
    "direct-wireless",
    "Peer-to-peer wireless",
    "Allow nearby Apple devices to connect without a shared Wi-Fi network.",
  ],
] as const;

export function RemoteDesktopSettings() {
  const bridge = window.desktopBridge?.remoteDesktop;
  const supported = !!bridge && window.desktopBridge?.getClientPlatform() === "darwin";
  const query = useEnvironmentQuery(supported ? desktopRemoteDesktopAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the mounted settings view synchronized with native helper state and Mac permission changes.
  useEffect(() => {
    if (!supported) return;
    const timer = setInterval(refreshRemoteDesktop, 3_000);
    window.addEventListener("focus", refreshRemoteDesktop);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshRemoteDesktop);
    };
  }, [supported]);
  if (!supported) return null;
  const change = (command: DesktopRemoteDesktopCommand) => {
    if (!bridge || pending) return;
    setPending(true);
    setError(null);
    void bridge
      .change(command)
      .then(refreshRemoteDesktop)
      .catch(() => setError("Could not apply this change. Please try again."))
      .finally(() => setPending(false));
  };
  const unavailable = !state || pending;
  const permissionsReady = state?.permissions?.screenRecording && state.permissions.accessibility;
  const status = !state
    ? "Loading…"
    : !state.enabled
      ? "Off"
      : !state.ready
        ? "Starting…"
        : !permissionsReady
          ? "Needs permission"
          : "Ready to connect";
  return (
    <SettingsSection id="remote-desktop" title="Remote Desktop">
      <SettingsRow
        title="Allow Remote Desktop"
        description="View and control this Mac from your iPhone or iPad. Turning this off disconnects active sessions. Applies only to this Mac."
        status={
          <span role="status" className="text-xs text-muted-foreground">
            {status}
          </span>
        }
        control={
          <Switch
            aria-label="Allow Remote Desktop"
            checked={state?.enabled ?? false}
            disabled={unavailable}
            onCheckedChange={(enabled) => change({ action: enabled ? "enable" : "disable" })}
          />
        }
      />
      {Boolean(error || query.error) && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {error ?? "Could not load Remote Desktop settings."}
        </p>
      )}
      <fieldset className="mx-4 my-5 space-y-2" disabled={unavailable}>
        <legend className="mb-2 text-sm font-medium">Host availability</legend>
        {(
          [
            [
              "with-t3",
              "With T3 Code",
              "Default · Quitting T3 Code stops remote access. Closing the window keeps it available.",
            ],
            [
              "persistent",
              "Persistent remote desktop",
              "Keep remote access on after quitting T3 Code. Stop it from the menu bar; opening T3 Code starts it again.",
            ],
          ] as const
        ).map(([value, label, description]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3 has-checked:border-primary has-checked:bg-primary/5"
          >
            <input
              type="radio"
              name="remote-desktop-lifecycle"
              className="mt-1 accent-primary"
              value={value}
              checked={state?.lifecycle === value}
              onChange={() => change({ action: "lifecycle", value })}
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SettingsRow
        title="macOS permissions"
        description={
          !state?.permissions
            ? "Checking Screen Recording and Accessibility…"
            : `Screen Recording: ${state.permissions.screenRecording ? "allowed" : "needed"} · Accessibility: ${state.permissions.accessibility ? "allowed" : "needed"}`
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable}
            onClick={() => change({ action: "permissions" })}
          >
            Manage permissions…
          </Button>
        }
      />
      <SettingsRow
        title="Pair a device"
        description="Approve a new iPhone or iPad with a temporary pairing code. Paired devices stay trusted until you revoke them."
        control={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={unavailable || !state?.ready || !permissionsReady}
              onClick={() => change({ action: "pair" })}
            >
              Pair iPhone or iPad…
            </Button>
            {state?.pairing && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => change({ action: "cancel-pairing" })}
              >
                Cancel pairing
              </Button>
            )}
          </div>
        }
      />
      <div className="pt-4">
        <h3 className="px-4 pb-1 text-xs font-medium text-muted-foreground">Sharing</h3>
        {sharing.map(([key, title, description]) => (
          <SettingsRow
            key={key}
            title={title}
            description={description}
            control={
              <Switch
                aria-label={title}
                checked={state?.preferences[key] ?? true}
                disabled={unavailable}
                onCheckedChange={(value) => change({ action: "setting", key, value })}
              />
            }
          />
        ))}
      </div>
      <AdvancedSettings targetIds={[]}>
        {networking.map(([key, title, description]) => (
          <SettingsRow
            key={key}
            title={title}
            description={description}
            control={
              <Switch
                aria-label={title}
                checked={state?.preferences[key] ?? false}
                disabled={unavailable}
                onCheckedChange={(value) => change({ action: "setting", key, value })}
              />
            }
          />
        ))}
        <SettingsRow
          title="Revoke paired devices"
          description="Disconnect every desktop device and require them to pair again. You’ll be asked to confirm."
          control={
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={unavailable || !state?.ready}
              onClick={() => change({ action: "forget-devices" })}
            >
              Revoke all devices…
            </Button>
          }
        />
      </AdvancedSettings>
    </SettingsSection>
  );
}
