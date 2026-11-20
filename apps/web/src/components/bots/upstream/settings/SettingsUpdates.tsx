/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import type { ReactNode } from "react";
import { SettingsCard, SettingsRow, SettingsSection, SourceButton } from "./SettingsParts";
export function SettingsUpdates({
  version,
  track,
  message,
  busy,
  action,
  onAction,
  onWhatsNew,
  scheduling,
  preferences,
  error,
}: {
  version: string;
  track: string;
  message: string;
  busy: boolean;
  action?: string;
  onAction?: () => void;
  onWhatsNew?: () => void;
  scheduling?: ReactNode;
  preferences?: ReactNode;
  error?: string | null;
}) {
  return (
    <SettingsSection title="Software update">
      {scheduling}
      {onWhatsNew && <SourceButton onClick={onWhatsNew}>What’s new</SourceButton>}
      <SettingsCard>
        <SettingsRow title="Update channel" description="Choose which releases this app follows.">
          <span className="settings-modal-readonly-value">{track}</span>
        </SettingsRow>
        <SettingsRow title={`Version ${version}`} description={message}>
          {action && onAction && (
            <SourceButton disabled={busy} onClick={onAction}>
              {action}
            </SourceButton>
          )}
        </SettingsRow>
        {preferences}
      </SettingsCard>
      {error && (
        <p role="alert" className="openbot-settings-error">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
