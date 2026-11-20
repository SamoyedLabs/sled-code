/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useId, useState, type ReactNode } from "react";
import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "../../../../hooks/useSettings";
import { useTheme } from "../../../../hooks/useTheme";
import { SettingsCard, SettingsRow, SettingsSection } from "./SettingsParts";

export function SettingsGeneral({
  appearance,
  conversations,
  behavior,
  permissions,
}: {
  appearance?: ReactNode;
  conversations?: ReactNode;
  behavior?: ReactNode;
  permissions?: ReactNode;
}) {
  const theme = useTheme();
  const settings = useClientSettings();
  const hydrated = useClientSettingsHydrated();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <>
      <SettingsSection title="Appearance">
        <SettingsCard>
          <SettingsRow
            title="Theme"
            id={`${id}-theme`}
            description="Light or dark colors. System follows the setting of your device."
          >
            <select
              className="ui-native-select"
              data-size="sm"
              aria-labelledby={`${id}-theme`}
              value={theme.appearanceMode}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "system" || value === "dark" || value === "light")
                  setError(
                    theme.setAppearanceMode(value)
                      ? null
                      : "The theme preference could not be saved.",
                  );
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </SettingsRow>
          {appearance}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Conversations">
        <SettingsCard>
          <SettingsRow
            title="Send message with"
            id={`${id}-send`}
            description="Choose the keyboard shortcut that sends a message."
          >
            <select
              className="ui-native-select"
              data-size="sm"
              aria-labelledby={`${id}-send`}
              disabled={!hydrated}
              value={settings.sendShortcut}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "enter" || value === "mod-enter" || value === "mod-enter-multiline")
                  void updateClientSettings({ sendShortcut: value }).then(
                    () => setError(null),
                    () => setError("The send shortcut could not be saved."),
                  );
              }}
            >
              <option value="enter">Enter</option>
              <option value="mod-enter">⌘ / Ctrl + Enter</option>
              <option value="mod-enter-multiline">⌘ / Ctrl + Enter for multiline</option>
            </select>
          </SettingsRow>
          {conversations}
        </SettingsCard>
      </SettingsSection>
      {behavior && (
        <SettingsSection title="App behavior">
          <SettingsCard>{behavior}</SettingsCard>
        </SettingsSection>
      )}
      {permissions && (
        <SettingsSection title="Permissions">
          <SettingsCard>{permissions}</SettingsCard>
        </SettingsSection>
      )}
      {error && (
        <p role="alert" className="openbot-settings-error">
          {error}
        </p>
      )}
    </>
  );
}
