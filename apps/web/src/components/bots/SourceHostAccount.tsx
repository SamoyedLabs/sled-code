/* oxlint-disable shadcn/no-unknown-classes -- Pinned AccountLogin structure, artwork, OTP and source styles. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingRequest } from "@t3tools/client-runtime/openbot/settings";
import { readPreparedConnection, usePreparedConnection } from "../../state/session";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useSourceSettingsActions } from "./SourceSettingsActions";
import { AccountLogo } from "./upstream/settings/AccountLogo";
import { AccountOtpInput } from "./upstream/settings/AccountOtpInput";
import { SettingsProfile } from "./upstream/settings/SettingsProfile";
import { SourceButton, SettingsSection } from "./upstream/settings/SettingsParts";
import { accountText as t } from "./upstream/settings/account-text";
import {
  accountCallbackQuery,
  decodeHostAccount,
  normalizeAccountCode,
  normalizeAccountEmail,
  type HostAccountView,
} from "./upstream/settings/account-model";
import "./upstream/settings/account-auth.css";

export function SourceHostAccount(props: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
}) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (connection !== session.connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <HostAccount
      key={JSON.stringify([props.environmentId, props.hostId, session.epoch])}
      {...props}
    />
  );
}

function HostAccount({
  environmentId,
  hostId,
  hostName,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
}) {
  const { actions, capabilities } = useSourceSettingsActions(environmentId, hostId);
  const [view, setView] = useState<HostAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [callbackAddress, setCallbackAddress] = useState("");
  const [now, setNow] = useState(Date.now);
  const connection = useRef(readPreparedConnection(environmentId));
  const lock = useRef(false),
    mounted = useRef(true);
  const statusRequest = settingRequest("settings.host-account.status", {});
  const canRead =
    capabilities.includes("host-account-v1") &&
    statusRequest !== null &&
    actions.can(statusRequest);
  const run = useStableCallback(
    async (
      action:
        | "status"
        | "emailStart"
        | "emailVerify"
        | "retry"
        | "logout"
        | "companyOpen"
        | "companyComplete"
        | "cancel",
      parameters: Record<string, Schema.Json> = {},
    ) => {
      if (
        lock.current ||
        !mounted.current ||
        connection.current !== readPreparedConnection(environmentId)
      )
        return;
      const request = settingRequest(`settings.host-account.${action}`, parameters);
      if (!request || !actions.can(request)) {
        setError("Account-management permission is required on this host.");
        return;
      }
      lock.current = true;
      setPending(action);
      setError(null);
      try {
        const value = decodeHostAccount(await actions.execute(request));
        if (mounted.current && connection.current === readPreparedConnection(environmentId))
          setView(value);
      } catch (cause) {
        if (mounted.current && connection.current === readPreparedConnection(environmentId))
          setError(
            cause instanceof Error
              ? cause.message
              : "The account request could not complete. Check its status before retrying.",
          );
      } finally {
        lock.current = false;
        if (mounted.current) setPending(null);
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the selected host's account through its guarded bridge; discard replies after unmount or connection replacement.
  useEffect(() => {
    mounted.current = true;
    if (canRead) void run("status");
    return () => {
      mounted.current = false;
    };
  }, [canRead, run]);
  const state = view?.state;
  const challenge = state?.status === "code_sent" ? state : null;
  const deadline = challenge?.resendAvailableAt ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source resend countdown runs only while a challenge is waiting.
  useEffect(() => {
    if (!deadline || deadline <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reconcile company sign-in while its private flow is pending; no authentication mutation is retried by polling.
  useEffect(() => {
    if (state?.status !== "company_sign_in" && state?.status !== "signing_in") return;
    const timer = setInterval(() => {
      if (!document.hidden) void run("status");
    }, 2000);
    return () => clearInterval(timer);
  }, [state?.status, run]);
  if (!canRead)
    return (
      <SettingsSection title="OpenBot account">
        <p>
          This host does not expose account settings, or account-management permission is missing.
        </p>
      </SettingsSection>
    );
  if (state?.status === "signed_in")
    return <SettingsProfile account={state.user} onSignOut={() => run("logout")} />;
  const company = state?.status === "company_sign_in";
  const issue = state && "issue" in state ? state.issue : undefined;
  const unavailable = state?.status === "error" && issue?.code === "auth_api_unavailable";
  const resendIn = Math.max(0, Math.ceil((deadline - now) / 1000));
  const flow = view?.flow;
  const send = () => {
    const value = normalizeAccountEmail(challenge?.email ?? email);
    if (!value) {
      setError(t("account.login.emailInvalid"));
      return;
    }
    void run("emailStart", { email: value });
  };
  const verify = (value: string) => {
    const normalized = normalizeAccountCode(value);
    if (!normalized || !challenge || !flow) return;
    void run("emailVerify", {
      flowId: flow.id,
      challengeId: challenge.challengeId,
      code: normalized,
    });
  };
  const reset = () => {
    if (flow) void run("cancel", { flowId: flow.id }).then(() => setCode(""));
    else void run("logout");
  };
  return (
    <div className="host-account-settings">
      <p className="ui-text" data-variant="caption" data-tone="muted">
        OpenBot account on {hostName}
      </p>
      <div className="account-login-screen">
        <div className="account-login-shell">
          <div className="account-login-brand-lockup">
            <AccountLogo />
            <span className="account-login-wordmark">OpenBot</span>
          </div>
          <section
            className="account-login"
            data-transition={challenge || company ? "forward" : "back"}
            aria-labelledby="account-login-title"
          >
            <h1 id="account-login-title" className="account-login-title">
              {!state || state.status === "loading"
                ? t("account.login.connectingTitle")
                : unavailable
                  ? t("account.login.unavailableTitle")
                  : company
                    ? t("account.login.companyTitle")
                    : challenge
                      ? t("account.login.checkInboxTitle")
                      : t("account.login.signInTitle")}
            </h1>
            <p className="account-login-description">
              {company
                ? t("account.login.companyDescription", { email: state.email })
                : challenge
                  ? t("account.login.codeSent", { email: challenge.email })
                  : t("account.login.signInDescription")}
            </p>
            {error && (
              <p className="account-login-error" role="alert">
                {error}
              </p>
            )}
            {issue && (
              <p className="account-login-error" role="alert">
                {issue.message}
              </p>
            )}
            {!state || state.status === "loading" ? (
              <div className="account-login-loader" role="status">
                <span className="account-login-spinner" />
                {t("account.login.connectingSecurely")}
              </div>
            ) : unavailable ? (
              <SourceButton
                className="account-login-primary"
                disabled={!!pending}
                onClick={() => void run("retry")}
              >
                Try again
              </SourceButton>
            ) : company ? (
              <div className="account-login-form" data-auth-panel="company">
                <div className="account-login-loader" role="status">
                  <span className="account-login-spinner" />
                  {t("account.login.companyWaiting")}
                </div>
                {flow?.authorizeUrl && (
                  <a
                    className="ui-button ui-button-variant-default account-login-primary"
                    href={flow.authorizeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open sign-in page
                  </a>
                )}
                {flow && (
                  <SourceButton
                    disabled={!!pending}
                    onClick={() => void run("companyOpen", { flowId: flow.id })}
                  >
                    {t("account.login.companyOpenAgain")}
                  </SourceButton>
                )}
                {flow?.callback && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const query = accountCallbackQuery(callbackAddress, flow.callback!);
                      if (!query) {
                        setError("Use the exact return address from this sign-in page.");
                        return;
                      }
                      void run("companyComplete", { flowId: flow.id, callbackQuery: query });
                    }}
                  >
                    <label htmlFor="account-callback">Return address</label>
                    <input
                      id="account-callback"
                      className="ui-input"
                      type="url"
                      value={callbackAddress}
                      onChange={(event) => setCallbackAddress(event.target.value)}
                      autoComplete="off"
                    />
                    <p className="ui-text" data-variant="caption">
                      If this host is on another device, paste the final localhost address here
                      after signing in.
                    </p>
                    <SourceButton type="submit" disabled={!!pending || !callbackAddress}>
                      Complete sign-in
                    </SourceButton>
                  </form>
                )}
                <div className="account-login-code-actions">
                  <SourceButton
                    className="account-login-code-action account-login-code-action-change"
                    variant="ghost"
                    disabled={!!pending}
                    onClick={reset}
                  >
                    <ArrowLeft size={14} />
                    {t("account.login.companyUseAnotherEmail")}
                  </SourceButton>
                </div>
              </div>
            ) : challenge ? (
              <div className="account-login-form" data-auth-panel="code" aria-busy={!!pending}>
                <AccountOtpInput
                  key={challenge.challengeId}
                  value={code}
                  onChange={setCode}
                  onComplete={verify}
                  status={pending === "emailVerify" ? "verifying" : issue ? "error" : "idle"}
                  disabled={!!pending || !flow}
                  errorMessage={issue?.message ?? null}
                  hint={t("account.login.codeHint")}
                />
                <div className="account-login-code-actions">
                  <SourceButton
                    className="account-login-code-action account-login-code-action-change"
                    variant="ghost"
                    disabled={!!pending}
                    onClick={reset}
                  >
                    <ArrowLeft size={14} />
                    {t("account.login.changeEmail")}
                  </SourceButton>
                  <SourceButton
                    className="account-login-code-action"
                    variant="ghost"
                    disabled={!!pending || resendIn > 0}
                    onClick={send}
                  >
                    {resendIn
                      ? t("account.login.resendIn", { time: `${resendIn}s` })
                      : t("account.login.resend")}
                  </SourceButton>
                </div>
              </div>
            ) : (
              <form
                className="account-login-form"
                data-auth-panel="email"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="sr-only" htmlFor="account-email">
                  {t("account.login.email")}
                </label>
                <div className="account-login-email-field t-input-wrap">
                  <input
                    className="ui-input t-input"
                    id="account-email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={!!pending || state.status === "signing_in"}
                  />
                </div>
                <SourceButton
                  variant="default"
                  className="account-login-primary"
                  type="submit"
                  disabled={!!pending || !email.trim() || state.status === "signing_in"}
                >
                  {pending ? t("account.login.sendingCode") : t("account.login.sendCode")}
                </SourceButton>
                <div className="account-login-footer">
                  <p className="account-login-local-data">
                    <Lock size={13} />
                    {t("account.login.localData")}
                  </p>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
