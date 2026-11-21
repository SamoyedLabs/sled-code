/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useState, type ReactNode } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Pencil, UserRound } from "lucide-react";
import { confirmed } from "../../../settings/BotConnectionControls";
import { SettingsCard, SettingsRow, SettingsSection, SourceButton } from "./SettingsParts";
import "./profile.css";
export type ProfileSession = {
  readonly id: string;
  readonly name: string;
  readonly current: boolean;
  readonly kind: string;
  readonly connectedAt: number;
  readonly lastActiveAt: number;
};
export function SettingsProfile({
  account,
  activity,
  sessions,
  sessionsLoading,
  sessionsError,
  onRefreshSessions,
  onRevokeSession,
  onEdit,
  onSignOut,
}: {
  account: {
    readonly name?: string | null;
    readonly email: string;
    readonly avatarUrl?: string | null;
  };
  activity?: ReactNode;
  sessions?: readonly ProfileSession[];
  sessionsLoading?: boolean;
  sessionsError?: string | null;
  onRefreshSessions?: () => Promise<void>;
  onRevokeSession?: (id: string) => Promise<void>;
  onEdit?: () => void;
  onSignOut?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    const settled = await settlePromise(action);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "This account action failed.");
    }
    setBusy(null);
  };
  const name = account.name?.trim() || account.email.split("@")[0] || account.email;
  return (
    <>
      <section className="profile-hero" aria-label="Profile">
        <span className="profile-hero-avatar">
          {account.avatarUrl ? (
            <img src={account.avatarUrl} alt="" />
          ) : (
            <UserRound aria-hidden="true" />
          )}
        </span>
        <div className="profile-hero-text">
          <h3>{name}</h3>
        </div>
        {onEdit && (
          <div className="profile-hero-actions">
            <SourceButton onClick={onEdit}>
              <Pencil size={14} className="profile-icon-edit" aria-hidden="true" />
              Edit profile
            </SourceButton>
          </div>
        )}
      </section>
      {activity}
      <SettingsSection title="Account">
        <SettingsCard>
          <SettingsRow title="Email" description="Used to sign in to OpenBot.">
            <span className="settings-modal-readonly-value">{account.email}</span>
            {onSignOut && (
              <SourceButton disabled={busy !== null} onClick={() => void run("signout", onSignOut)}>
                {busy === "signout" ? "Signing out…" : "Sign out"}
              </SourceButton>
            )}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {sessions !== undefined && (
        <SettingsSection
          title="Signed-in devices"
          actions={
            onRefreshSessions && (
              <SourceButton
                disabled={sessionsLoading || busy !== null}
                onClick={() => void run("sessions", onRefreshSessions)}
              >
                {sessionsLoading ? "Loading…" : "Refresh"}
              </SourceButton>
            )
          }
        >
          <SettingsCard>
            {sessions.map((session) => (
              <SettingsRow
                key={session.id}
                title={`${session.name}${session.current ? " · This device" : ""}`}
                description={`${session.kind} · Signed in ${new Date(session.connectedAt).toLocaleString()} · Last active ${new Date(session.lastActiveAt).toLocaleString()}`}
              >
                {!session.current && onRevokeSession && (
                  <SourceButton
                    disabled={busy !== null}
                    onClick={() =>
                      void confirmed(
                        `Disconnect ${session.name}? This device will need to sign in again.`,
                      ).then((ok) => {
                        if (ok) void run(session.id, () => onRevokeSession(session.id));
                      })
                    }
                  >
                    Disconnect
                  </SourceButton>
                )}
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      {(error || sessionsError) && (
        <p role="alert" className="openbot-settings-error">
          {error ?? sessionsError}
        </p>
      )}
    </>
  );
}
