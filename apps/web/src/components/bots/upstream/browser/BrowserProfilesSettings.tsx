import { COLOR_BY_ID } from "../../avatar/vendor/bloub-engine";
import { botAvatarProfile } from "../../avatar/avatar-profile";
/* oxlint-disable shadcn/no-unknown-classes -- Original BrowserProfilesPanel/item selectors are provided by scoped source styles. */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { browserProfiles } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  EllipsisIcon,
  PlusIcon,
  PencilIcon,
  LogOutIcon,
  Trash2Icon,
  CheckIcon,
} from "lucide-react";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { readPreparedConnection, usePreparedConnection } from "../../../../state/session";
import { Menu, MenuTrigger, MenuItem } from "../../../ui/menu";
import { MenuPopup } from "../OpenbotMenu";
import { SourceButton, SettingsCard, SettingsRow } from "../settings/SettingsParts";
import { requestConfirmDialog } from "../../../../confirmDialog";
import "./browser-profiles.css";

type Profiles = NonNullable<ReturnType<typeof browserProfiles>>;
const colors = [
  { hue: 0, name: "Red" },
  { hue: 30, name: "Orange" },
  { hue: 55, name: "Yellow" },
  { hue: 150, name: "Green" },
  { hue: 185, name: "Cyan" },
  { hue: 215, name: "Blue" },
  { hue: 245, name: "Indigo" },
  { hue: 320, name: "Magenta" },
] as const;
type Action = Extract<
  OpenbotAdminRequest,
  {
    operation:
      | "browser.profiles.create"
      | "browser.profiles.update"
      | "browser.profiles.clear"
      | "browser.profiles.delete";
  }
>;

export function BrowserProfilesSettings(props: { environmentId: EnvironmentId; hostId: string }) {
  return (
    <ProfilesEnvironment key={JSON.stringify([props.environmentId, props.hostId])} {...props} />
  );
}
function ProfilesEnvironment({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const [snapshot, setSnapshot] = useState<{
    connection: typeof connection;
    profiles: Profiles;
  } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "browser.profiles.list" },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const lock = useRef(false);
  const load = async (captured: typeof connection) => {
    const result = await admin({
      environmentId,
      input: { hostId, request: { operation: "browser.profiles.list" } },
    });
    if (readPreparedConnection(environmentId) !== captured) return;
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    const profiles = browserProfiles(result.value);
    if (!profiles) throw Error("The host returned an unsupported browser profile list.");
    setSnapshot({ connection: captured, profiles });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The released profiles list is a read-only admin route; load it on this exact connection and ignore stale replies.
  useEffect(() => {
    if (!connection || !canManage) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Both snapshot and failure updates occur after the awaited remote list request, not synchronously during the effect.
    void load(connection).catch((cause) => {
      if (readPreparedConnection(environmentId) === connection)
        setError(cause instanceof Error ? cause.message : "Browser profiles could not be loaded.");
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Mount and connection changes trigger the read; mutation refreshes are explicit below.
  }, [connection, canManage]);
  const act = async (request: Action) => {
    if (!canManage || lock.current || !connection) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await admin({ environmentId, input: { hostId, request } });
      if (readPreparedConnection(environmentId) !== connection) return false;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      try {
        await load(connection);
      } catch {
        setError(
          "The profile change was confirmed, but the list could not refresh. Refresh to see the saved result.",
        );
      }
      return true;
    } catch (cause) {
      if (readPreparedConnection(environmentId) === connection)
        setError(
          cause instanceof Error
            ? cause.message
            : "The profile change could not be confirmed. Refresh before trying again.",
        );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <BrowserProfilesPanel
      profiles={canManage && snapshot?.connection === connection ? snapshot.profiles : null}
      disabled={!canManage || busy}
      error={canManage ? error : "Host settings permission is required to manage browser profiles."}
      onAction={act}
      onRefresh={() => {
        if (connection) void load(connection).catch((cause) => setError(String(cause)));
      }}
    />
  );
}
export function BrowserProfilesPanel({
  profiles,
  disabled,
  error,
  onAction,
  onRefresh,
}: {
  profiles: Profiles | null;
  disabled: boolean;
  error: string | null;
  onAction: (request: Action) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="browser-profiles-panel">
      {error && (
        <p role="alert" className="openbot-settings-error">
          {error} <SourceButton onClick={onRefresh}>Refresh</SourceButton>
        </p>
      )}
      {!profiles && !error && <p role="status">Loading browser profiles…</p>}
      {profiles && (
        <SettingsCard>
          <SettingsRow
            title="Shared profile"
            description="The default browser sign-ins shared by agents without a named profile."
          />
          {profiles.map((profile) => (
            <div className="ui-item settings-modal-row" key={profile.id}>
              <div className="ui-item-media">
                {" "}
                <Menu>
                  <MenuTrigger
                    render={
                      <SourceButton
                        variant="ghost"
                        disabled={disabled}
                        className="browser-profile-color-trigger"
                        aria-label={`Color for ${profile.name}`}
                      />
                    }
                  >
                    <span
                      className="browser-profile-dot"
                      style={{
                        background: COLOR_BY_ID.get(botAvatarProfile(profile.id, profile.hue).color)
                          ?.hex,
                      }}
                    />
                  </MenuTrigger>
                  <MenuPopup>
                    {colors.map((color) => (
                      <MenuItem
                        key={color.hue}
                        onClick={() =>
                          void onAction({
                            operation: "browser.profiles.update",
                            profileId: profile.id,
                            hue: color.hue,
                          })
                        }
                      >
                        {color.name}
                        {profile.hue === color.hue && <CheckIcon />}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </div>
              <div className="ui-item-content">
                <div className="ui-item-title">
                  {renaming?.id === profile.id ? (
                    <form
                      className="browser-profiles-row"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenaming(null);
                        }
                      }}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (
                          renaming.name.trim() &&
                          (await onAction({
                            operation: "browser.profiles.update",
                            profileId: profile.id,
                            name: renaming.name.trim(),
                          }))
                        )
                          setRenaming(null);
                      }}
                    >
                      <input
                        autoFocus
                        className="ui-input browser-profiles-name"
                        aria-label={`Rename ${profile.name}`}
                        maxLength={60}
                        value={renaming.name}
                        onChange={(event) =>
                          setRenaming({ id: profile.id, name: event.currentTarget.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenaming(null);
                          }
                        }}
                      />
                      <SourceButton type="submit" disabled={disabled || !renaming.name.trim()}>
                        Save
                      </SourceButton>
                    </form>
                  ) : (
                    profile.name
                  )}
                </div>
                <div className="ui-item-description">
                  {profile.agentIds.length} agents · {profile.tabCount} tabs
                </div>
              </div>
              <div className="ui-item-actions">
                <Menu>
                  <MenuTrigger
                    render={
                      <SourceButton
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`Actions for ${profile.name}`}
                      />
                    }
                  >
                    <EllipsisIcon size={16} />
                  </MenuTrigger>
                  <MenuPopup>
                    <MenuItem onClick={() => setRenaming({ id: profile.id, name: profile.name })}>
                      <PencilIcon />
                      Rename
                    </MenuItem>
                    <MenuItem
                      onClick={async () => {
                        if (
                          await requestConfirmDialog(
                            `Clear ${profile.name}? Its tabs close and sites are signed out.`,
                            { variant: "destructive" },
                          )
                        )
                          await onAction({
                            operation: "browser.profiles.clear",
                            profileId: profile.id,
                          });
                      }}
                    >
                      <LogOutIcon />
                      Clear sign-ins
                    </MenuItem>
                    <MenuItem
                      onClick={async () => {
                        if (
                          await requestConfirmDialog(
                            `Delete ${profile.name}? Its tabs close and its agents return to the shared profile.`,
                            { variant: "destructive" },
                          )
                        )
                          await onAction({
                            operation: "browser.profiles.delete",
                            profileId: profile.id,
                          });
                      }}
                    >
                      <Trash2Icon />
                      Delete profile
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            </div>
          ))}
        </SettingsCard>
      )}
      <form
        className="browser-profiles-row"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            name.trim() &&
            (await onAction({ operation: "browser.profiles.create", name: name.trim() }))
          )
            setName("");
        }}
      >
        <input
          className="ui-input browser-profiles-name"
          aria-label="New profile name"
          placeholder="New profile"
          maxLength={60}
          disabled={disabled}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <SourceButton type="submit" disabled={disabled || !name.trim()}>
          <PlusIcon size={16} />
          New profile
        </SourceButton>
      </form>
    </div>
  );
}
