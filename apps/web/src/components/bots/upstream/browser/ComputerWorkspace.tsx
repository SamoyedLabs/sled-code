/* oxlint-disable shadcn/no-unknown-classes -- Source RemoteDesktopWorkspace surface using the existing Sled-owned viewer grant. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Monitor } from "lucide-react";
import type { useBotComputer } from "../../../settings/useBotComputer";
import { SourceButton } from "../settings/SettingsParts";
import { SourceSelect } from "../provider/SourceSelect";
import { BotAvatar } from "../../avatar/BotAvatar";
import { t } from "./text";
export function ComputerWorkspace({
  computer,
  hostId,
  onBack,
}: {
  computer: ReturnType<typeof useBotComputer>;
  hostId: string;
  onBack: () => void;
}) {
  const session = computer.viewer;
  const [viewerState, setViewerState] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [viewerError, setViewerError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Validate first-pixel reports against this exact viewer frame, origin and owned session; stop waiting after the source timeout.
  useEffect(() => {
    if (!session) return;
    const received = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== new URL(session.url).origin
      )
        return;
      const value: unknown = event.data;
      if (
        typeof value !== "object" ||
        !value ||
        !("source" in value) ||
        value.source !== "openbot-moonlight" ||
        !("type" in value) ||
        value.type !== "viewer-state" ||
        !("sessionId" in value) ||
        value.sessionId !== session.id ||
        !("state" in value)
      )
        return;
      if (value.state === "connecting" || value.state === "connected" || value.state === "error") {
        setViewerState(value.state);
        if (value.state === "error")
          setViewerError(
            "message" in value && typeof value.message === "string"
              ? value.message
              : t("remoteDesktop.controlFailed"),
          );
      }
    };
    window.addEventListener("message", received);
    const timer = setTimeout(() => {
      setViewerState((current) => (current === "connecting" ? "error" : current));
      setViewerError((current) => current ?? t("remoteDesktop.streamNotReady"));
    }, 60000);
    return () => {
      window.removeEventListener("message", received);
      clearTimeout(timer);
    };
  }, [session]);
  const state = computer.error
    ? "error"
    : computer.busy
      ? "connecting"
      : session
        ? viewerState
        : "idle";
  const displays = computer.capabilities?.displays ?? [];
  return (
    <main
      className="remote-desktop-workspace remote-desktop-workspace-visible"
      aria-label={t("remoteDesktop.workspaceLabel")}
      tabIndex={-1}
    >
      <header className="window-drag remote-desktop-header">
        {displays.length > 1 && (
          <div className="no-drag remote-desktop-display-controls">
            <SourceSelect
              className="remote-desktop-display-select"
              value={computer.capabilities?.selectedDisplayId}
              options={displays.map((display) => ({ id: display.id, name: display.label }))}
              disabled={computer.busy}
              label={t("remoteDesktop.displayLabel")}
              onChange={computer.selectDisplay}
            />
          </div>
        )}
        <div className="no-drag remote-desktop-actions">
          <SourceButton
            className="remote-desktop-back-button"
            size="sm"
            variant="ghost"
            onClick={onBack}
          >
            <ArrowLeft size={14} />
            {t("remoteDesktop.backToOpenBot")}
          </SourceButton>
          <SourceButton
            className="remote-desktop-disconnect-button"
            size="sm"
            variant="ghost"
            disabled={computer.busy || !session?.canClose()}
            onClick={computer.closeViewer}
          >
            {t("remoteDesktop.disconnect")}
          </SourceButton>
        </div>
      </header>
      <div className="remote-desktop-stage">
        {session && (
          <iframe
            ref={frame}
            className="remote-desktop-viewer"
            title={t("remoteDesktop.viewerTitle")}
            src={session.url}
            // oxlint-disable-next-line react/iframe-missing-sandbox -- This exact authenticated viewer needs its existing same-origin decoder and input transport.
            sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock"
            allow="fullscreen; keyboard-map"
            referrerPolicy="no-referrer"
            onLoad={() => setViewerState("connecting")}
            onError={() => {
              setViewerState("error");
              setViewerError(t("remoteDesktop.viewerLoadFailed"));
            }}
          />
        )}
        {state === "connecting" && (
          <div className="remote-desktop-overlay" role="status">
            <BotAvatar seed={`${hostId}:remote-desktop-connecting`} size={72} />
            <strong>{t("common.connecting")}</strong>
          </div>
        )}
        {state === "error" && (
          <div className="remote-desktop-overlay remote-desktop-error" role="alert">
            <strong>{t("remoteDesktop.openFailed")}</strong>
            <span>{viewerError ?? computer.error ?? t("remoteDesktop.controlFailed")}</span>
            <SourceButton
              variant="outline"
              onClick={session ? computer.closeViewer : computer.openViewer}
            >
              {t(session ? "remoteDesktop.disconnect" : "common.tryAgain")}
            </SourceButton>
          </div>
        )}
        {state === "idle" && (
          <div className="remote-desktop-overlay">
            <span className="remote-desktop-empty-mark">
              <Monitor />
            </span>
            <strong>{t("remoteDesktop.workspaceLabel")}</strong>
            <SourceButton onClick={computer.openViewer}>{t("remoteDesktop.connect")}</SourceButton>
          </div>
        )}
      </div>
    </main>
  );
}
