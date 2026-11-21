import { SourceHostAccount } from "./SourceHostAccount";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthSessionId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AppSettingsPage } from "./upstream/settings/SettingsPage";
import { SettingsGeneral } from "./upstream/settings/SettingsGeneral";
import { SettingsNotifications } from "./upstream/settings/SettingsNotifications";
import { SettingsComputerUse, type ComputerUsePort } from "./upstream/settings/SettingsComputerUse";
import { SettingsUpdates } from "./upstream/settings/SettingsUpdates";
import { SettingsMobileConnect } from "./upstream/settings/SettingsMobileConnect";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SourceButton,
} from "./upstream/settings/SettingsParts";
import { SourceSwitch } from "./upstream/settings/SourceSwitch";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getDesktopUpdateButtonTooltip,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { authEnvironment } from "../../state/auth";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { usePrimaryEnvironmentId } from "../../state/environments";
const decodeSessionId = Schema.decodeSync(AuthSessionId);
const unavailable = (title: string, description: string) => (
  <SettingsSection title={title}>
    <SettingsCard>
      <SettingsRow title={description} />
    </SettingsCard>
  </SettingsSection>
);
function NativeComputerSettings() {
  const [port] = useState<ComputerUsePort>(() => {
    const native = window.desktopBridge?.remoteDesktop;
    const read: ComputerUsePort["getState"] = async () => {
      if (!native)
        return {
          status: "unsupported",
          permissions: [],
          message: "Computer permissions are available in the Sled desktop app on macOS.",
        };
      const state = await native.getState();
      if (!state.permissions)
        return {
          status: "driver-missing",
          permissions: [],
          message: "The desktop sharing helper is not available.",
        };
      const permissions = [
        { id: "screen-recording" as const, granted: state.permissions.screenRecording },
        { id: "accessibility" as const, granted: state.permissions.accessibility },
      ];
      return {
        status: permissions.every((permission) => permission.granted)
          ? "ready"
          : "permissions-required",
        permissions,
      };
    };
    return {
      getState: read,
      openPermissionPane: async () => {
        if (!native) throw Error("The desktop app is required.");
        await native.change({ action: "permissions" });
        return read();
      },
    };
  });
  return <SettingsComputerUse port={port} />;
}
function AppUpdates() {
  const state = useDesktopUpdateState();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  if (!state)
    return unavailable(
      "Software update",
      window.desktopBridge
        ? "Reading desktop update status…"
        : "This web client updates when its connected server is updated.",
    );
  const bridge = window.desktopBridge,
    action = resolveDesktopUpdateButtonAction(state);
  const perform = async () => {
    if (lock.current || !bridge || !state.enabled) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "download"
          ? await bridge.downloadUpdate()
          : action === "install"
            ? await bridge.installUpdate(
                state.downloadedVersion ?? state.availableVersion ?? undefined,
              )
            : await bridge.checkForUpdate();
      if ("accepted" in result && result.accepted === false)
        setError("The update action was refused. Refresh the current update status.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The update could not complete.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <SettingsUpdates
      version={state.currentVersion}
      track={state.channel}
      message={
        state.enabled
          ? getDesktopUpdateButtonTooltip(state)
          : (state.message ?? "Updates are disabled for this development build.")
      }
      busy={busy || state.status === "downloading" || state.status === "checking"}
      {...(state.enabled
        ? {
            action:
              action === "download"
                ? "Download update"
                : action === "install"
                  ? "Restart and install"
                  : "Check for updates",
            onAction: () => void perform(),
          }
        : {})}
      error={error}
    />
  );
}
function LocalBehavior() {
  const bridge = window.desktopBridge?.remoteDesktop;
  const [state, setState] = useState<Awaited<
      ReturnType<NonNullable<typeof bridge>["getState"]>
    > | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the actual native sharing lifecycle; reading it does not start a server or change persistent streaming.
  useEffect(() => {
    if (!bridge) return;
    let current = true;
    const read = () =>
      void bridge.getState().then(
        (value) => {
          if (current) setState(value);
        },
        () => {
          if (current) setError("Could not read desktop sharing preferences.");
        },
      );
    read();
    window.addEventListener("focus", read);
    return () => {
      current = false;
      window.removeEventListener("focus", read);
    };
  }, [bridge]);
  if (!bridge) return null;
  return (
    <>
      <SettingsRow
        title="Keep remote sessions running"
        description="Keep the desktop sharing helper available after Sled closes."
      >
        <SourceSwitch
          label="Keep remote sessions running"
          checked={state?.lifecycle === "persistent"}
          disabled={!state || busy}
          onChange={(checked) => {
            setBusy(true);
            void bridge
              .change({ action: "lifecycle", value: checked ? "persistent" : "with-t3" })
              .then(() => bridge.getState())
              .then(setState)
              .catch(() => setError("The sharing preference could not be saved."))
              .finally(() => setBusy(false));
          }}
        />
      </SettingsRow>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
function MobileSettings({ environmentId }: { environmentId: EnvironmentId | null }) {
  const navigate = useNavigate(),
    primary = usePrimaryEnvironmentId();
  const readable = useEnvironmentScope(environmentId, AuthAccessReadScope),
    writable = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const access = useEnvironmentQuery(
    environmentId && readable
      ? authEnvironment.accessChanges({ environmentId, input: null })
      : null,
  );
  const sessions = access.data?.type === "snapshot" ? access.data.payload.clientSessions : null;
  const phones =
    sessions
      ?.filter(
        ({ client: device }) => device.deviceType === "mobile" || device.deviceType === "tablet",
      )
      .map(({ client: device, ...session }) => ({
        sessionId: session.sessionId,
        name: device.label ?? session.subject,
        platform: device.os === "ios" ? ("ios" as const) : ("unknown" as const),
        via: "session" as const,
        lastActiveAt: DateTime.toEpochMillis(session.lastConnectedAt ?? session.issuedAt),
      })) ?? null;
  const revokeClient = useAtomCommand(authEnvironment.revokeClient, { reportFailure: false });
  const revoke = async (id: string) => {
    if (
      !environmentId ||
      environmentId !== primary ||
      !readEnvironmentScope(environmentId, AuthAccessWriteScope)
    )
      throw Error("Access-management permission on this environment is required.");
    const result = await revokeClient({
      environmentId,
      input: { sessionId: decodeSessionId(id) },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  };
  return (
    <SettingsMobileConnect
      devices={phones}
      loading={access.isPending}
      error={!readable ? "Access permission is required to read connected devices." : access.error}
      onAddPhone={() => void navigate({ to: "/settings/connections" })}
      {...(writable && environmentId === primary ? { onDisconnect: revoke } : {})}
      route={
        <SourceButton onClick={() => void navigate({ to: "/settings/connections" })}>
          Manage connections
        </SourceButton>
      }
    />
  );
}
export function SourceAppSettings({
  environmentId,
  hostId,
  hostName,
  initialSection,
  onHostSettings,
}: {
  environmentId: EnvironmentId | null;
  hostId: string | null;
  hostName: string;
  initialSection?: import("./upstream/settings/SettingsPage").AppSettingsTab;
  onHostSettings: () => void;
}) {
  const navigate = useNavigate();
  return (
    <AppSettingsPage
      {...(initialSection ? { initialSection } : {})}
      panels={{
        general: <SettingsGeneral behavior={<LocalBehavior />} />,
        agents: (
          <SettingsSection title="Agent defaults">
            <SettingsCard>
              <SettingsRow
                title="Defaults for this host"
                description="Agent capabilities and model defaults belong to the selected host."
              >
                <SourceButton onClick={onHostSettings}>Open host settings</SourceButton>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        ),
        profile:
          environmentId && hostId ? (
            <SourceHostAccount environmentId={environmentId} hostId={hostId} hostName={hostName} />
          ) : (
            unavailable("Profile", "Connect to a host to manage its OpenBot account.")
          ),
        notifications: <SettingsNotifications />,
        voice: (
          <SettingsSection title="Dictation">
            <SettingsCard>
              <SettingsRow
                title="Voice input"
                description="Sled uses its native speech service for the message composer."
              >
                <SourceButton onClick={() => void navigate({ to: "/settings/general" })}>
                  Voice settings
                </SourceButton>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        ),
        "dynamic-island": unavailable(
          "Dynamic Island",
          "The OpenBot floating island is not available in this Sled client.",
        ),
        "computer-use": <NativeComputerSettings />,
        billing: (
          <SettingsSection title="Billing">
            <SettingsCard>
              <SettingsRow
                title="Sled Connect account"
                description="Plans and account settings are managed through Sled Connect."
              >
                <SourceButton onClick={() => void navigate({ to: "/settings/connections" })}>
                  Open Sled Connect
                </SourceButton>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        ),
        "mobile-connect": <MobileSettings environmentId={environmentId} />,
        updates: <AppUpdates />,
      }}
    />
  );
}
