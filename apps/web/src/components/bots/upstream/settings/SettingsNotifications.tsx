import { SourceSwitch } from "./SourceSwitch";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useState, type ReactNode } from "react";
import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "../../../../hooks/useSettings";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  unlockNotificationAudio,
} from "../../../../threadNotifications";
import { SettingsCard, SettingsRow, SettingsSection } from "./SettingsParts";

export function SettingsNotifications({
  matrix,
  preview,
  test,
  actionSounds,
}: {
  matrix?: ReactNode;
  preview?: ReactNode;
  test?: ReactNode;
  actionSounds?: ReactNode;
}) {
  const mode = useClientSettings((settings) => settings.notificationMode);
  const ready = useClientSettingsHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = hasDesktopNotifications(mode);
  const sound = hasNotificationSound(mode);
  const change = async (notifications: boolean, sounds: boolean) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (sounds) unlockNotificationAudio();
      if (notifications && !desktop) {
        if (typeof Notification === "undefined" || !window.isSecureContext)
          throw new Error("Notifications need a supported browser over HTTPS, or the desktop app.");
        if ((await Notification.requestPermission()) !== "granted")
          throw new Error(
            "Allow notifications in your browser or system settings, then try again.",
          );
      }
      await updateClientSettings({
        notificationMode: notifications
          ? sounds
            ? "notifications-and-sound"
            : "notifications"
          : sounds
            ? "sound"
            : "off",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The notification preference could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {matrix && <SettingsSection title="What you hear">{matrix}</SettingsSection>}
      <SettingsSection title="On this computer">
        <SettingsCard>
          <SettingsRow
            title="Desktop notifications"
            description="Show a notification when a task finishes or needs your attention."
          >
            <SourceSwitch
              label="Desktop notifications"
              checked={desktop}
              disabled={!ready || busy}
              onChange={(checked) => void change(checked, sound)}
            />
          </SettingsRow>
          {preview}
          {test}
          <SettingsRow
            title="Play a sound when a task finishes"
            description="Hear when an agent finishes a task."
          >
            <SourceSwitch
              label="Play a sound when a task finishes"
              checked={sound}
              disabled={!ready || busy}
              onChange={(checked) => void change(desktop, checked)}
            />
          </SettingsRow>
          {actionSounds}
        </SettingsCard>
      </SettingsSection>
      {error && (
        <p role="alert" className="openbot-settings-error">
          {error}
        </p>
      )}
    </>
  );
}
