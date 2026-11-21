/* oxlint-disable shadcn/no-unknown-classes -- Source ProviderCodeLoginDialog and OpenCodeKeyDialog DOM and CSS. */
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Copy, X, OctagonX } from "lucide-react";
import { QRCodeSvg } from "../../../ui/qr-code";
import { SourceButton } from "../settings/SettingsParts";
import { currentText } from "./text";
import "./ProviderSignIn.css";
const { t } = currentText();
export type ProviderCodeState =
  | { phase: "starting" | "verifying" }
  | {
      phase: "code" | "paste" | "link";
      verificationUrl: string;
      userCode?: string;
      verificationUrlComplete?: string;
      expiresAt: number;
    }
  | {
      phase: "relay";
      hostName: string;
      authorizeUrl: string | null;
      pasteable: boolean;
      expiresAt: number;
    }
  | { phase: "page"; hostName: string; page: ReactNode };
export function ProviderCodeLoginDialog(props: {
  name: string;
  state: ProviderCodeState;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void>;
  onOpen: (url: string) => void;
}) {
  const [value, setValue] = useState(""),
    [now, setNow] = useState(Date.now),
    [copied, setCopied] = useState(false);
  const state = props.state;
  const expiresAt = "expiresAt" in state ? state.expiresAt : null;
  const seconds = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Only visible source code/link expiry phases need a one-second clock.
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const url = "verificationUrl" in state ? state.verificationUrl : null;
  const shortUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.host + parsed.pathname;
    } catch {
      return url;
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="provider-code-login-backdrop">
            <Dialog.Popup
              className="provider-code-login-dialog"
              data-page={state.phase === "page" ? "" : undefined}
              render={<section />}
            >
              <header className="provider-code-login-header">
                <Dialog.Title className="provider-code-login-title">
                  {t(
                    state.phase === "link"
                      ? "provider.codeLogin.linkTitle"
                      : state.phase === "relay" || state.phase === "page"
                        ? "provider.codeLogin.pageTitle"
                        : "provider.codeLogin.title",
                    { name: props.name },
                  )}
                </Dialog.Title>
                <Dialog.Description className="provider-code-login-description">
                  {t(
                    state.phase === "relay"
                      ? state.authorizeUrl
                        ? state.pasteable
                          ? "mcp.signIn.relayOpenDescription"
                          : "mcp.signIn.relayDeviceDescription"
                        : "provider.codeLogin.relayStarting"
                      : state.phase === "page"
                        ? "provider.codeLogin.pageDescription"
                        : "provider.codeLogin.description",
                    {
                      name: props.name,
                      host: "hostName" in state ? state.hostName : "",
                      page:
                        state.phase === "relay" && state.authorizeUrl
                          ? new URL(state.authorizeUrl).host
                          : "",
                    },
                  )}
                </Dialog.Description>
              </header>
              <div className="provider-code-login-body">
                {(state.phase === "starting" || state.phase === "verifying") && (
                  <div className="provider-code-login-pending" role="status">
                    <span className="ui-spinner" />
                    <span className="ui-text" data-tone="muted">
                      {t(
                        state.phase === "starting"
                          ? "provider.codeLogin.starting"
                          : "provider.codeLogin.verifying",
                        { name: props.name },
                      )}
                    </span>
                  </div>
                )}
                {url && "verificationUrl" in state && (
                  <div className="provider-code-login-code">
                    <QRCodeSvg
                      value={state.verificationUrlComplete ?? url}
                      size={160}
                      title={t("provider.codeLogin.qrLabel", { name: props.name })}
                    />
                    <ol className="provider-code-login-steps">
                      <li>
                        <span>{t("provider.codeLogin.open")}</span>{" "}
                        <button
                          className="ui-button ui-button-variant-link provider-code-login-url"
                          onClick={() => props.onOpen(url)}
                        >
                          {state.phase === "code" ? url : shortUrl(url)}
                          <ExternalLink aria-hidden="true" />
                        </button>
                      </li>
                      <li>
                        {t(
                          state.phase === "code"
                            ? "provider.codeLogin.enterCode"
                            : state.phase === "paste"
                              ? "provider.codeLogin.pasteStep"
                              : "provider.codeLogin.linkStep",
                          { name: props.name },
                        )}
                      </li>
                    </ol>
                    {state.phase === "code" && (
                      <div className="provider-code-login-value" role="status">
                        <output
                          className="provider-code-login-digits"
                          aria-label={t("provider.codeLogin.codeLabel", {
                            code: state.userCode?.split("").join(" ") ?? "",
                          })}
                        >
                          {state.userCode}
                        </output>
                        <SourceButton
                          className="provider-code-login-copy"
                          aria-label={t(copied ? "common.copied" : "provider.codeLogin.copyCode")}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(state.userCode ?? "")
                              .then(() => setCopied(true));
                          }}
                        >
                          <Copy />
                        </SourceButton>
                      </div>
                    )}
                    {state.phase === "paste" && (
                      <form
                        className="provider-code-login-paste"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (value.trim() && !props.busy)
                            void props.onSubmit(value.trim()).then(() => setValue(""));
                        }}
                      >
                        <label className="ui-field">
                          <span className="ui-label">{t("provider.codeLogin.pasteLabel")}</span>
                          <input
                            className="ui-input"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={props.busy}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          />
                        </label>
                        <SourceButton
                          type="submit"
                          variant="default"
                          disabled={!value.trim() || props.busy}
                        >
                          {t("provider.codeLogin.pasteSubmit")}
                        </SourceButton>
                      </form>
                    )}
                    <p
                      className="ui-text provider-code-login-expiry"
                      data-variant="caption"
                      data-tone="muted"
                      aria-live="off"
                    >
                      {t(
                        seconds > 0
                          ? state.phase === "code"
                            ? "provider.codeLogin.expiresIn"
                            : "provider.codeLogin.pasteExpiresIn"
                          : state.phase === "code"
                            ? "provider.codeLogin.expired"
                            : "provider.codeLogin.pasteExpired",
                        { time: countdown },
                      )}
                    </p>
                  </div>
                )}
                {state.phase === "relay" &&
                  (state.authorizeUrl ? (
                    <SourceSignInRelayControls
                      page={{
                        authorizeHost: new URL(state.authorizeUrl).host,
                        listening: false,
                        pasteable: state.pasteable,
                      }}
                      onOpen={() => props.onOpen(state.authorizeUrl!)}
                      onPaste={props.onSubmit}
                    />
                  ) : (
                    <div className="provider-code-login-pending" role="status">
                      <span className="ui-spinner" />
                      <span className="ui-text" data-tone="muted">
                        {t("provider.codeLogin.relayStarting", {
                          name: props.name,
                          host: state.hostName,
                        })}
                      </span>
                    </div>
                  ))}
                {state.phase === "page" && state.page}
                {props.error && (
                  <p className="ui-field-error" role="alert">
                    {props.error}
                  </p>
                )}
              </div>
              <SourceButton
                variant="ghost"
                className="provider-code-login-close ui-icon-button"
                aria-label={t("provider.codeLogin.closeLabel", { name: props.name })}
                onClick={props.onCancel}
              >
                <X />
              </SourceButton>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const KEY_NAMES: Record<string, string> = {
  opencode: "openCode",
  muse: "muse",
  antigravity: "gemini",
  claude: "claude",
  codex: "codex",
  inception: "inception",
  deepseek: "deepseek",
  openrouter: "openrouter",
};
export function ProviderKeyDialog(props: {
  provider: string;
  name: string;
  status: "missing" | "saved" | "unreadable" | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (key: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const prefix = `provider.${KEY_NAMES[props.provider] ?? "openCode"}Key`;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="opencode-key-backdrop">
            <Dialog.Popup className="opencode-key-dialog" render={<section />}>
              <header className="opencode-key-header">
                <Dialog.Title className="opencode-key-title">{t(`${prefix}.title`)}</Dialog.Title>
                <Dialog.Description className="opencode-key-description">
                  {props.status === "saved" && (
                    <span className="opencode-key-status-dot" aria-hidden="true" />
                  )}
                  {t(
                    props.status === "saved"
                      ? "provider.openCodeKey.saved"
                      : props.status === "unreadable"
                        ? "provider.openCodeKey.unreadable"
                        : `${prefix}.description`,
                  )}
                </Dialog.Description>
              </header>
              <form
                className="opencode-key-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (key.trim() && !props.busy) {
                    const submitted = key.trim();
                    setKey("");
                    void props.onSave(submitted);
                  }
                }}
              >
                <label className="ui-field">
                  <span className="ui-label">{t(`${prefix}.label`)}</span>
                  <input
                    className="ui-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={512}
                    placeholder={t("provider.openCodeKey.placeholder")}
                    value={key}
                    disabled={props.busy}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
                {props.error && (
                  <div className="ui-alert opencode-key-alert" data-tone="danger" role="alert">
                    <span className="ui-alert-icon">
                      <OctagonX />
                    </span>
                    <div className="ui-alert-content">
                      <div className="ui-alert-title">{props.name}</div>
                      <div className="ui-alert-description">{props.error}</div>
                    </div>
                  </div>
                )}
                <footer className="opencode-key-actions">
                  <SourceButton
                    variant="ghost"
                    size="default"
                    disabled={props.busy}
                    onClick={props.onClose}
                  >
                    {t("common.cancel")}
                  </SourceButton>
                  {props.status && props.status !== "missing" && (
                    <SourceButton
                      variant="destructive-ghost"
                      size="default"
                      disabled={props.busy}
                      onClick={() => void props.onRemove()}
                    >
                      {t("provider.openCodeKey.remove")}
                    </SourceButton>
                  )}
                  <SourceButton
                    type="submit"
                    variant="default"
                    size="default"
                    disabled={props.busy || !key.trim()}
                  >
                    {t("provider.openCodeKey.save")}
                  </SourceButton>
                </footer>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SourceSignInRelayControls(props: {
  page: { authorizeHost: string; listening: boolean; pasteable: boolean };
  onOpen: () => void | Promise<void>;
  onPaste: (address: string) => Promise<void>;
}) {
  const [address, setAddress] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try {
      await props.onOpen();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <>
      <SourceButton
        variant="default"
        size="default"
        className="mcp-sign-in-relay-open"
        onClick={() => void open()}
      >
        {t("mcp.signIn.relayOpen")}
      </SourceButton>
      {props.page.pasteable ? (
        <form
          className="mcp-sign-in-relay-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (sending || !address.trim()) return;
            setSending(true);
            setError(null);
            void props
              .onPaste(address)
              .catch((cause) => setError(String(cause)))
              .finally(() => setSending(false));
          }}
        >
          <label className="ui-field">
            <span className="ui-label">{t("mcp.signIn.relayAddress")}</span>
            <span className="ui-field-description">
              {t(
                props.page.listening
                  ? "mcp.signIn.relayPasteHint"
                  : "mcp.signIn.relayPasteRequired",
              )}
            </span>
            <div className="mcp-sign-in-relay-row">
              <input
                className="ui-input"
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <SourceButton type="submit" disabled={sending || !address.trim()}>
                {t("mcp.signIn.relaySend")}
              </SourceButton>
            </div>
            {error && (
              <span className="ui-field-error" role="alert">
                {error}
              </span>
            )}
          </label>
        </form>
      ) : error ? (
        <div className="ui-alert" data-tone="danger" role="alert">
          <div className="ui-alert-description">{error}</div>
        </div>
      ) : null}
    </>
  );
}

export function ProviderUseAppDialog({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="provider-code-login-backdrop">
            <Dialog.Popup className="provider-code-login-dialog" render={<section />}>
              <header className="provider-code-login-header">
                <Dialog.Title className="provider-code-login-title">
                  {t("provider.useApp.title", { name })}
                </Dialog.Title>
                <Dialog.Description className="provider-code-login-description">
                  {t("provider.useApp.description", { name })}
                </Dialog.Description>
              </header>
              <div className="provider-code-login-body provider-use-app-actions">
                <SourceButton variant="outline" onClick={onClose}>
                  {t("common.close")}
                </SourceButton>
                <SourceButton
                  onClick={() =>
                    window.open("https://openbot.run/download", "_blank", "noopener,noreferrer")
                  }
                >
                  {t("provider.useApp.download")}
                </SourceButton>
              </div>
              <SourceButton
                className="provider-code-login-close ui-icon-button"
                variant="ghost"
                size="sm"
                aria-label={t("common.close")}
                onClick={onClose}
              >
                <X />
              </SourceButton>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
