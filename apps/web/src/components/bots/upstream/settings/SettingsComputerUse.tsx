/* oxlint-disable shadcn/no-unknown-classes -- Original ComputerUseSetup selectors are supplied by source CSS. */
import { useEffect, useRef, useState } from "react";
import { CircleCheck, Monitor, MousePointer2, RefreshCw, TriangleAlert } from "lucide-react";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { SettingsSection, SourceButton } from "./SettingsParts";
import "./computer-use.css";

export type ComputerPermission = "screen-recording" | "accessibility";
export interface ComputerUseState {
  status: "ready" | "permissions-required" | "unsupported" | "driver-missing" | "error";
  permissions: readonly { id: ComputerPermission; granted: boolean }[];
  message?: string;
}
export interface ComputerUsePort {
  getState: () => Promise<ComputerUseState>;
  openPermissionPane: (permission: ComputerPermission) => Promise<ComputerUseState>;
}
const permissionDetails = {
  "screen-recording": {
    title: "Screen Recording",
    description: "Lets OpenBot see app windows.",
    icon: Monitor,
  },
  accessibility: {
    title: "Accessibility",
    description: "Lets OpenBot click and type.",
    icon: MousePointer2,
  },
};
export function SettingsComputerUse({ port }: { port: ComputerUsePort }) {
  const [state, setState] = useState<ComputerUseState | null>(null);
  const [busy, setBusy] = useState<ComputerPermission | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const act = useStableCallback(async (permission?: ComputerPermission) => {
    if (lock.current) return;
    const current = generation.current;
    lock.current = true;
    setBusy(permission ?? "check");
    setError(null);
    try {
      const next = permission ? await port.openPermissionPane(permission) : await port.getState();
      if (generation.current === current) setState(next);
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : "OpenBot could not check Computer Use.");
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(null);
      }
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Native permission grants change outside this window; re-read the driver on focus and ignore results after cleanup.
  useEffect(() => {
    const refresh = () => {
      void act();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      lock.current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [act]);
  const permissions = state?.permissions ?? [];
  const showPermissions =
    (state?.status === "ready" || state?.status === "permissions-required") &&
    permissions.length > 0;
  const unavailable = state && ["unsupported", "driver-missing", "error"].includes(state.status);
  return (
    <div className="computer-use-settings">
      {!state && busy && <p role="status">Checking Computer Use…</p>}
      {(unavailable || (error && !showPermissions)) && (
        <div className="ui-alert computer-use-alert" data-tone="warning" role="status">
          <span className="ui-alert-icon">
            <TriangleAlert />
          </span>
          <div className="ui-alert-content">
            <div className="ui-alert-title">Computer Use isn’t available yet</div>
            <div className="ui-alert-description">
              {error ?? state?.message ?? "OpenBot could not start the Computer Use driver."}
            </div>
          </div>
          <div className="ui-alert-actions">
            <SourceButton disabled={busy !== null} onClick={() => void act()}>
              <RefreshCw />
              Try again
            </SourceButton>
          </div>
        </div>
      )}
      {showPermissions && (
        <SettingsSection title="System permissions" description="Permissions are managed by macOS.">
          <div className="ui-item-group settings-modal-card computer-use-card computer-use-permission-list">
            {permissions.map((permission) => {
              const details = permissionDetails[permission.id];
              return (
                <div
                  key={permission.id}
                  className="ui-item settings-modal-row computer-use-row"
                  data-size="default"
                >
                  <div className="ui-item-media computer-use-permission-icon">
                    <details.icon aria-hidden="true" />
                  </div>
                  <div className="ui-item-content">
                    <div className="ui-item-title">{details.title}</div>
                    <div className="ui-item-description">{details.description}</div>
                  </div>
                  <div className="ui-item-actions">
                    {permission.granted && (
                      <span
                        className="z-badge z-badge-variant-success-light"
                        data-variant="success-light"
                      >
                        <CircleCheck aria-hidden="true" />
                        Granted
                      </span>
                    )}
                    <SourceButton
                      className={permission.granted ? "" : "computer-use-grant"}
                      disabled={busy !== null}
                      aria-label={`${permission.granted ? "Manage" : "Grant"} ${details.title}`}
                      onClick={() => void act(permission.id)}
                    >
                      {busy === permission.id
                        ? "Opening…"
                        : permission.granted
                          ? "Manage"
                          : "Grant"}
                    </SourceButton>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="computer-use-recheck">
            <SourceButton disabled={busy !== null} onClick={() => void act()}>
              <RefreshCw aria-hidden="true" />
              Check again
            </SourceButton>
          </div>
        </SettingsSection>
      )}
      {state?.status === "ready" && permissions.length === 0 && (
        <div className="ui-alert computer-use-alert" data-tone="success" role="status">
          <span className="ui-alert-icon">
            <CircleCheck />
          </span>
          <div className="ui-alert-content">
            <div className="ui-alert-title">Computer Use is ready</div>
            <div className="ui-alert-description">
              OpenBot can see and interact with apps on this computer. This system asks for no extra
              permission.
            </div>
          </div>
        </div>
      )}
      {error && showPermissions && <p role="alert">Couldn’t open System Settings: {error}</p>}
    </div>
  );
}
