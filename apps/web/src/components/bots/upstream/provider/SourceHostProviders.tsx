import { toastManager } from "../../../ui/toast";
import { CustomEndpoints } from "./CustomEndpoints";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned Providers settings presentation uses source scoped selectors. */
import { useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  providerAdminRequest,
  providerSetupResult,
  EMPTY_PROVIDER_SETUP,
  providerRelayCallbackQuery,
  botModelVisibility,
} from "@t3tools/client-runtime/openbot/presentation";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { useEnvironmentQuery } from "../../../../state/query";
import { useSourceProviderData } from "../../SourceProviderEnvironment";
import {
  ProviderSettingsPage,
  type ProviderSettingsActions,
  type ProviderSettingsPageProps,
} from "./ProviderSettingsPage";
import {
  ProviderCodeLoginDialog,
  ProviderKeyDialog,
  ProviderUseAppDialog,
  type ProviderCodeState,
} from "./ProviderSignInDialogs";
import { agentProviderName, isAgentProvider } from "./identity";
import {
  codeSignInStatus,
  providerWebConnectRoute,
  type ProviderLoginMethod,
  type ProviderSettingsOption,
} from "./provider-settings-model";
import { accountUsageProviderRows } from "./account-usage-view";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SourceButton,
} from "../settings/SettingsParts";
import { SourceSelect } from "./SourceSelect";
import { SourceSwitch } from "./SourceSwitch";
import { currentText } from "./text";
import { readAgentStatus } from "./types";
const { t } = currentText();
const decodeAgents = Schema.decodeUnknownResult(
  Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, provider: Schema.String })),
);
const decodeCredits = Schema.decodeUnknownSync(
  Schema.Struct({
    accounts: Schema.Array(
      Schema.Struct({
        provider: Schema.String,
        accountId: Schema.String,
        available: Schema.Number,
      }),
    ),
  }),
);
const decodeReset = Schema.decodeUnknownSync(
  Schema.Struct({
    outcome: Schema.Literals(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]),
  }),
);
const decodeKey = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literals(["missing", "saved", "unreadable"]) }),
);
const decodeCache = Schema.decodeUnknownSync(Schema.Struct({ ttl: Schema.Literals(["5m", "1h"]) }));
type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  onDetailChange?: ProviderSettingsPageProps["onDetailChange"];
  renderHostSignInPage?: ((tabId: string) => ReactNode) | undefined;
};
export type ProviderSettingsExecute = (input: unknown) => Promise<unknown>;
export function SourceHostProviders(props: Props) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (connection !== session.connection) setSession({ connection, epoch: session.epoch + 1 });
  return <Host key={`${props.environmentId}:${props.hostId}:${session.epoch}`} {...props} />;
}
function Host(props: Props) {
  const { environmentId, hostId } = props;
  const data = useSourceProviderData();
  const registry = useContext(RegistryContext);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = readPreparedConnection(environmentId),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    lock = useRef(false);
  const [keyStates, setKeyStates] = useState<Record<string, "saved" | "missing" | "unreadable">>(
    {},
  );
  const [keyRevision, setKeyRevision] = useState(0);
  const [dialog, setDialog] = useState<{
    kind: "key" | "connect" | "use-app";
    method?: ProviderLoginMethod;
    provider: string;
    accountId?: string | null;
  } | null>(null);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agentsParsed = decodeAgents(agentsQuery.data);
  const agents = Result.isSuccess(agentsParsed) ? agentsParsed.success : null;
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.accounts.list" },
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fence private provider results when this host session is removed.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const accepts = (input: unknown) => {
    const request = providerAdminRequest(input);
    return Boolean(
      request &&
      allowed &&
      registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })),
    );
  };
  const execute: ProviderSettingsExecute = async (input) => {
    const request = providerAdminRequest(input);
    if (!request) throw new Error("This host cannot accept that provider action.");
    if (
      (!alive.current && !request.operation.endsWith(".cancel")) ||
      !connection ||
      readPreparedConnection(environmentId) !== connection
    )
      throw new Error("Reconnect the original provider session.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You do not have permission to manage these providers.");
    const response = await admin({ environmentId, input: { hostId, request } });
    if (response._tag === "Failure") throw squashAtomCommandFailure(response);
    if (!alive.current || readPreparedConnection(environmentId) !== connection)
      throw new Error("The original provider session changed.");
    return response.value;
  };
  const run = async (input: unknown) => {
    if (lock.current) throw new Error("Wait for the current provider change.");
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await execute(input);
      data?.refresh();
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Provider change failed.");
      throw cause;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const keyProviders = (data?.status?.providers ?? [])
    .map((row) => row.id)
    .filter(
      (provider) =>
        provider === "opencode" ||
        provider === "muse" ||
        (provider === "claude" && capabilities.includes("claude-api-key-v1")) ||
        (["inception", "deepseek", "openrouter"].includes(provider) &&
          capabilities.includes("providers-v8")),
    )
    .join(",");
  const readKeyStates = useEffectEvent(async (ids: string, _revision: number) => {
    const entries = await Promise.all(
      ids
        .split(",")
        .filter(Boolean)
        .map(async (provider) => {
          try {
            return [
              provider,
              decodeKey(await execute({ operation: "provider.apiKey.state", provider })).status,
            ] as const;
          } catch {
            return null;
          }
        }),
    );
    return Object.fromEntries(entries.filter((entry) => entry !== null));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read only write-only key status for the host-supported provider cards, and repeat after a key mutation.
  useEffect(() => {
    let active = true;
    if (allowed)
      void readKeyStates(keyProviders, keyRevision).then((values) => {
        if (active) setKeyStates(values);
      });
    return () => {
      active = false;
    };
  }, [allowed, keyProviders, keyRevision]);
  const options: ProviderSettingsOption[] = (data?.status?.providers ?? []).map((o) => {
    const providerAgents = agents?.filter((agent) => agent.provider === o.id);
    const runtime = isAgentProvider(o.id) ? data?.runtimeStatuses[o.id] : undefined;
    const keyStatus = allowed ? keyStates[o.id] : undefined;
    return {
      ...o,
      ...(keyStatus ? { keyStatus } : {}),
      name: o.displayName ?? (isAgentProvider(o.id) ? agentProviderName(o.id) : o.id),
      ...(runtime ? { runtimeStatus: runtime } : {}),
      ...(providerAgents ? { usedBy: providerAgents.map((a) => a.name) } : {}),
      ...(o.accounts
        ? {
            accounts: o.accounts.map((account) => ({
              ...account,
              ...(providerAgents && data?.accounts
                ? {
                    usedBy: providerAgents
                      .filter(
                        (agent) =>
                          (data.accounts?.agents.find((a) => a.agentId === agent.id)?.accountId ??
                            "default") === account.id,
                      )
                      .map((a) => a.name),
                  }
                : {}),
            })),
          }
        : {}),
    };
  });
  const actions = (provider: string): ProviderSettingsActions => {
    const runtime = isAgentProvider(provider) ? data?.runtimeStatuses[provider] : undefined;
    const keyAllowed =
      provider === "opencode" ||
      provider === "muse" ||
      (provider === "claude" && capabilities.includes("claude-api-key-v1")) ||
      (["inception", "deepseek", "openrouter"].includes(provider) &&
        capabilities.includes("providers-v8"));
    const hostPage =
      provider === "antigravity" &&
      capabilities.includes("provider-host-sign-in-v1") &&
      Boolean(props.renderHostSignInPage);
    const route = providerWebConnectRoute(provider, capabilities, hostPage);
    const allowedMethod = (method: ProviderLoginMethod | "use-app" | null) =>
      Boolean(
        method &&
        accepts({
          operation:
            method === "code"
              ? "provider.codeLogin.start"
              : method === "host-page"
                ? "provider.hostSignIn.start"
                : "provider.signInRelay.start",
          provider,
        }),
      );
    const openSignIn = (method: ProviderLoginMethod | "use-app", accountId?: string | null) =>
      setDialog({
        kind: method === "use-app" ? "use-app" : "connect",
        provider,
        ...(method !== "use-app" ? { method } : {}),
        ...(accountId !== undefined ? { accountId } : {}),
      });
    const multiple =
      capabilities.includes("provider-accounts-v1") &&
      Boolean(data?.accounts?.providers.some((p) => p.provider === provider));
    return {
      usageResets:
        capabilities.includes("provider-usage-reset-v1") &&
        accepts({ operation: "provider.usageResets.list", provider })
          ? async () =>
              decodeCredits(
                await execute({ operation: "provider.usageResets.list", provider }),
              ).accounts.filter((row) => row.provider === provider)
          : undefined,
      resetUsage:
        capabilities.includes("provider-usage-reset-v1") &&
        accepts({ operation: "provider.usageResets.consume", provider, accountId: "default" })
          ? async (accountId) => {
              const value = decodeReset(
                await execute({ operation: "provider.usageResets.consume", provider, accountId }),
              );
              data?.refresh();
              return value.outcome;
            }
          : undefined,
      accountConnect:
        Boolean(props.renderHostSignInPage) ||
        capabilities.includes(
          provider === "antigravity" ? "provider-account-relay-v2" : "provider-account-relay-v1",
        ),
      connect:
        allowedMethod(route.connect) && route.connect
          ? (_id, accountId) => {
              if (accountId !== undefined)
                openSignIn(
                  capabilities.includes(
                    provider === "antigravity"
                      ? "provider-account-relay-v2"
                      : "provider-account-relay-v1",
                  )
                    ? "relay"
                    : "host-page",
                  accountId,
                );
              else if (route.connect) openSignIn(route.connect);
            }
          : keyAllowed && accepts({ operation: "provider.apiKey.set", provider, key: "x" })
            ? () => setDialog({ kind: "key", provider })
            : undefined,
      alternative:
        route.alternative && allowedMethod(route.alternative)
          ? { kind: "address", run: () => openSignIn("relay") }
          : undefined,
      apiKey:
        keyAllowed && accepts({ operation: "provider.apiKey.state", provider })
          ? () => setDialog({ kind: "key", provider })
          : undefined,
      rename:
        multiple &&
        accepts({
          operation: "provider.account.rename",
          provider,
          accountId: "default",
          label: null,
        })
          ? (id, accountId, label) =>
              run({ operation: "provider.account.rename", provider: id, accountId, label })
          : undefined,
      remove:
        multiple &&
        accepts({ operation: "provider.account.remove", provider, accountId: "a0000000000000002" })
          ? (id, accountId) =>
              run({ operation: "provider.account.remove", provider: id, accountId })
          : undefined,
      cancelConnect: multiple
        ? (id) => run({ operation: "provider.account.signIn.cancel", provider: id })
        : undefined,
      signOut:
        capabilities.includes("provider-sign-out-v1") &&
        ["claude", "codex", "grok", "muse", "cursor"].includes(provider) &&
        accepts({ operation: "provider.signOut", provider })
          ? (id) => run({ operation: "provider.signOut", provider: id })
          : undefined,
      download:
        runtime && accepts({ operation: "provider.runtimes.download", provider })
          ? (id) => run({ operation: "provider.runtimes.download", provider: id })
          : undefined,
      cancelDownload:
        runtime && accepts({ operation: "provider.runtimes.cancel", provider })
          ? (id) => run({ operation: "provider.runtimes.cancel", provider: id })
          : undefined,
      update:
        runtime && accepts({ operation: "provider.runtimes.check" })
          ? async (id) => {
              if (runtime.availableVersion && runtime.availableVersion !== runtime.version)
                await run({ operation: "provider.runtimes.download", provider: id });
              else await run({ operation: "provider.runtimes.check" });
            }
          : undefined,
    };
  };
  const downloads = options.some(
    (o) => o.runtimeStatus?.phase === "downloading" || o.runtimeStatus?.phase === "finishing",
  );
  const refresh = useEffectEvent(() => data?.refresh());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The remote provider runtime changes outside React; refresh only while a reported download is active.
  useEffect(() => {
    if (!downloads) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [downloads]);
  if (!data?.status)
    return (
      <p role={data?.error ? "alert" : "status"}>
        {data?.error ? "Could not read this host’s providers." : "Loading providers…"}
      </p>
    );
  const modelsSlot = (provider: string) =>
    capabilities.includes("model-visibility-v1") &&
    accepts({ operation: "provider.modelVisibility.read", provider }) ? (
      <ProviderModels key={provider} provider={provider} execute={execute} onChange={refresh} />
    ) : null;
  return (
    <>
      <ProviderSettingsPage
        options={options}
        usage={accountUsageProviderRows(data.usage, data.status.providers)}
        actions={actions}
        disabled={busy}
        error={error}
        onDetailChange={props.onDetailChange}
        modelVisibility={modelsSlot}
        custom={
          capabilities.includes("providers-v1") && accepts({ operation: "provider.custom.list" })
            ? {
                connected: data.customProviders.length > 0,
                summary: new Intl.ListFormat().format(
                  data.customProviders.map((p) => p.name ?? p.id),
                ),
                detail: (
                  <CustomEndpoints
                    execute={execute}
                    ready={options.some(
                      (o) =>
                        o.id === "opencode" &&
                        (o.state === "available" || o.state === "sign-in-required"),
                    )}
                    onChange={refresh}
                  />
                ),
              }
            : undefined
        }
        promptCache={
          capabilities.includes("prompt-cache-ttl-v1") &&
          accepts({ operation: "settings.prompt-cache-ttl.update", parameters: { ttl: "5m" } }) ? (
            <PromptCache environmentId={environmentId} hostId={hostId} execute={execute} />
          ) : null
        }
      />
      {dialog?.kind === "key" && (
        <KeyConnection
          key={dialog.provider}
          provider={dialog.provider}
          execute={execute}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setKeyRevision((value) => value + 1);
            data.refresh();
          }}
        />
      )}
      {dialog?.kind === "use-app" && (
        <ProviderUseAppDialog
          name={
            isAgentProvider(dialog.provider) ? agentProviderName(dialog.provider) : dialog.provider
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "connect" && (
        <SignInConnection
          key={`${dialog.provider}:${dialog.accountId ?? ""}`}
          {...props}
          provider={dialog.provider}
          method={dialog.method ?? "code"}
          accountId={dialog.accountId}
          capabilities={capabilities}
          execute={execute}
          onClose={() => {
            setDialog(null);
            data.refresh();
          }}
        />
      )}
    </>
  );
}
function KeyConnection({
  provider,
  execute,
  onClose,
  onSaved,
}: {
  provider: string;
  execute: ProviderSettingsExecute;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"missing" | "saved" | "unreadable" | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null);
  const load = useEffectEvent(
    async () => decodeKey(await execute({ operation: "provider.apiKey.state", provider })).status,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A saved key is write-only; read only its state when the source key dialog opens.
  useEffect(() => {
    let active = true;
    void load()
      .then(
        (state) => {
          if (active) setStatus(state);
        },
        (cause) => {
          if (active) setError(String(cause));
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const change = async (input: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await execute(input);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProviderKeyDialog
      provider={provider}
      name={isAgentProvider(provider) ? agentProviderName(provider) : provider}
      status={status}
      busy={busy}
      error={error}
      onClose={onClose}
      onSave={(key) => change({ operation: "provider.apiKey.set", provider, key })}
      onRemove={() => change({ operation: "provider.apiKey.clear", provider })}
    />
  );
}
function SignInConnection(
  props: Props & {
    provider: string;
    method: ProviderLoginMethod;
    accountId: string | null | undefined;
    capabilities: readonly string[];
    execute: ProviderSettingsExecute;
    onClose: () => void;
  },
) {
  const { provider, execute } = props;
  const [state, setState] = useState<ProviderCodeState>({ phase: "starting" }),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const owner = useRef({ cancel: null as unknown, active: true });
  const setup = useRef(EMPTY_PROVIDER_SETUP);
  const codeStarted = useRef(false);
  const finish = (account?: string | null) => {
    owner.current.cancel = null;
    toastManager.add({
      type: "success",
      title: `${isAgentProvider(provider) ? agentProviderName(provider) : provider} connected`,
      description: account
        ? `Signed in as ${account}.`
        : "The sign-in finished on the other device.",
    });
    props.onClose();
  };
  const reload = useAtomQueryRunner(openbot.readFromHost, { refresh: true, reportFailure: false });
  const call = async (input: unknown) => {
    const request = providerAdminRequest(input);
    if (!request) throw new Error("Unsupported provider sign-in.");
    const value = await execute(request);
    setup.current = providerSetupResult(setup.current, request, value);
    if (setup.current.error) throw new Error(setup.current.error);
    return setup.current;
  };
  const start = useEffectEvent(async () => {
    const session = owner.current;
    await Promise.resolve();
    if (!session.active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!session.active) return;
      try {
        const deadline =
          setup.current.relay?.expiresAt ??
          (setup.current.codeSignIn && setup.current.codeSignIn.kind !== "connected"
            ? setup.current.codeSignIn.expiresAt
            : null);
        if (deadline !== null && Date.now() >= deadline) {
          toastManager.add({
            type: "warning",
            title: `The ${isAgentProvider(provider) ? agentProviderName(provider) : provider} code expired`,
            description: "Nobody entered it in time. That code no longer works.",
          });
          props.onClose();
          return;
        }
        if (setup.current.relay) {
          const next = await call({
            operation: "provider.signInRelay.status",
            flowId: setup.current.relay.flowId,
          });
          if (!session.active) return;
          const flow = next.relay;
          if (flow?.status?.result) {
            if (flow.status.result.error) throw new Error(flow.status.result.error);
            finish();
            return;
          }
          setState({
            phase: "relay",
            hostName: props.hostName,
            authorizeUrl: flow?.status?.authorizeUrl ?? null,
            pasteable: Boolean(flow?.status?.callback),
            expiresAt: flow?.expiresAt ?? 0,
          });
        } else if (setup.current.hostSignIn) {
          const next = await call({
            operation:
              props.accountId === undefined
                ? "provider.hostSignIn.status"
                : "provider.account.signIn.status",
            provider,
          });
          if (!session.active) return;
          if (next.hostSignIn?.result) {
            if (next.hostSignIn.result.error) throw new Error(next.hostSignIn.result.error);
            finish();
            return;
          }
          setState({
            phase: "page",
            hostName: props.hostName,
            page: next.hostSignIn?.tabId
              ? props.renderHostSignInPage?.(next.hostSignIn.tabId)
              : null,
          });
        } else {
          const result = await reload({
            environmentId: props.environmentId,
            input: { hostId: props.hostId, request: { operation: "agent.status" } },
          });
          if (!session.active) return;
          if (result._tag === "Success") {
            const found = readAgentStatus(result.value)?.providers?.find(
              (row) => row.id === provider,
            );
            const outcome = codeSignInStatus(codeStarted.current, found);
            codeStarted.current = outcome.started;
            if (outcome.outcome === "connected") {
              finish(found?.email);
              return;
            }
            if (outcome.outcome === "failed")
              throw new Error(found?.message ?? `Could not connect ${provider}`);
          }
        }
        if (session.active) timer = setTimeout(() => void loop(), 1500);
      } catch (cause) {
        if (session.active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    try {
      let next;
      if (props.method === "relay") {
        next = await call(
          props.accountId === undefined
            ? { operation: "provider.signInRelay.start", provider }
            : {
                operation: "provider.account.signInRelay.start",
                provider,
                accountId: props.accountId,
              },
        );
        session.cancel = { operation: "provider.signInRelay.cancel", flowId: next.relay?.flowId };
      } else if (props.method === "host-page") {
        next = await call(
          props.accountId !== undefined
            ? { operation: "provider.account.signIn.start", provider, accountId: props.accountId }
            : { operation: "provider.hostSignIn.start", provider },
        );
        session.cancel = {
          operation:
            props.accountId !== undefined
              ? "provider.account.signIn.cancel"
              : "provider.hostSignIn.cancel",
          provider,
        };
      } else {
        session.cancel = { operation: "provider.codeLogin.cancel", provider };
        next = await call({ operation: "provider.codeLogin.start", provider });
        if (next.codeSignIn?.kind === "connected") {
          if (session.active) finish();
          return;
        }
        const code = next.codeSignIn;
        if (code && session.active) setState({ ...code, phase: code.kind });
      }
      if (!session.active) {
        if (session.cancel) void execute(session.cancel).catch(() => {});
        return;
      }
      void loop();
    } catch (cause) {
      if (session.active) setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
  const release = useEffectEvent((input: unknown) => {
    void execute(input).catch(() => {});
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A provider sign-in owns its host flow, poll timer and cancellation for this mounted dialog only.
  useEffect(() => {
    const session = { active: true, cancel: null as unknown };
    owner.current = session;
    let stop: (() => void) | undefined;
    void start().then((cleanup) => {
      stop = cleanup;
    });
    return () => {
      session.active = false;
      stop?.();
      if (session.cancel) release(session.cancel);
    };
  }, []);
  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      if (setup.current.relay) {
        const flow = setup.current.relay;
        const query = flow.status?.callback
          ? providerRelayCallbackQuery(value, flow.status.callback)
          : null;
        if (!query) throw new Error("Paste the complete callback address from this sign-in.");
        const next = await call({
          operation: "provider.signInRelay.complete",
          flowId: flow.flowId,
          query,
        });
        if (next.relay?.status?.result?.error) throw new Error(next.relay.status.result.error);
        if (next.relay?.status?.result) finish();
      } else {
        await call({ operation: "provider.codeLogin.submit", provider, code: value });
        setState({ phase: "verifying" });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProviderCodeLoginDialog
      name={isAgentProvider(provider) ? agentProviderName(provider) : provider}
      state={state}
      error={error}
      busy={busy}
      onCancel={props.onClose}
      onSubmit={submit}
      onOpen={(url) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") throw new Error("Invalid sign-in page.");
        window.open(parsed.toString(), "_blank", "noopener,noreferrer");
      }}
    />
  );
}
function ProviderModels({
  provider,
  execute,
  onChange,
}: {
  provider: string;
  execute: ProviderSettingsExecute;
  onChange: () => void;
}) {
  const [list, setList] = useState<ReturnType<typeof botModelVisibility>>(null),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState<readonly string[]>([]);
  const lock = useRef(false);
  const load = useEffectEvent(async () => {
    const value = botModelVisibility(
      await execute({ operation: "provider.modelVisibility.read", provider }),
      provider,
    );
    if (!value) throw new Error("Invalid model list.");
    return value;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the full host visibility list when this provider detail opens; retain the initial shown-first order while editing.
  useEffect(() => {
    let active = true;
    void load().then(
      (value) => {
        if (!active) return;
        setList(value);
        setOrder(
          [
            ...value.models.filter((m) => value.shown.includes(m.id)),
            ...value.models.filter((m) => !value.shown.includes(m.id)),
          ].map((m) => m.id),
        );
      },
      (cause) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const change = async (shown: readonly string[] | null) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const previous = list;
    if (shown && list) setList({ ...list, shown });
    try {
      const value = botModelVisibility(
        await execute({ operation: "provider.modelVisibility.update", provider, shown }),
        provider,
      );
      if (!value) throw new Error("Invalid model list.");
      setList(value);
      onChange();
    } catch (cause) {
      setList(previous);
      setError(String(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const shown = new Set(list?.shown ?? []);
  const models = new Map(list?.models.map((m) => [m.id, m]) ?? []);
  const rows = order.flatMap((id) => {
    const model = models.get(id);
    return model && `${model.name} ${id}`.toLowerCase().includes(query.trim().toLowerCase())
      ? [model]
      : [];
  });
  if (!list?.models.length && !error) return null;
  return (
    <SettingsSection
      title={t("provider.settings.models")}
      description={t("provider.settings.modelsDescription", {
        shown: shown.size,
        count: list?.models.length ?? 0,
      })}
      actions={
        list && (
          <>
            {list.changed && (
              <SourceButton
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => void change(null)}
              >
                {t("provider.settings.modelsReset")}
              </SourceButton>
            )}
            <SourceButton
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => void change(shown.size ? [] : order)}
            >
              {t(
                shown.size ? "provider.settings.modelsHideAll" : "provider.settings.modelsShowAll",
              )}
            </SourceButton>
          </>
        )
      }
    >
      {error && (
        <p className="provider-settings-models-error" role="alert">
          {error}
        </p>
      )}
      {list && (
        <>
          <input
            className="ui-input"
            aria-label={t("provider.settings.modelsSearch")}
            placeholder={t("provider.settings.modelsSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ui-item-group settings-modal-card provider-settings-models">
            {rows.length ? (
              <ul className="provider-settings-models-list">
                {rows.map((model) => (
                  <li className="provider-settings-models-row" key={model.id}>
                    <span className="provider-settings-models-name">
                      <span className="ui-text" data-variant="body-sm">
                        {model.name}
                      </span>
                      <span
                        className="ui-text provider-settings-models-id"
                        data-variant="caption"
                        data-tone="muted"
                      >
                        {model.id}
                      </span>
                    </span>
                    <SourceSwitch
                      label={t("provider.settings.modelShow", { name: model.name, id: model.id })}
                      checked={shown.has(model.id)}
                      disabled={busy}
                      onChange={(on) =>
                        void change(order.filter((id) => (id === model.id ? on : shown.has(id))))
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <span
                className="ui-text provider-settings-models-empty"
                data-tone="muted"
                role="status"
              >
                {t("provider.settings.modelsNoMatch")}
              </span>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}
function PromptCache({
  environmentId,
  hostId,
  execute,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  execute: ProviderSettingsExecute;
}) {
  const command = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const [value, setValue] = useState<"5m" | "1h" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = useEffectEvent(async () => {
    const result = await command({
      environmentId,
      input: {
        hostId,
        request: { operation: "settings.prompt-cache-ttl.settings", parameters: {} },
      },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return decodeCache(result.value).ttl;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The Claude prompt-cache value belongs to this host and is unknown until its guarded read answers.
  useEffect(() => {
    let active = true;
    void load().then(
      (ttl) => {
        if (active) setValue(ttl);
      },
      (cause) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const change = async (ttl: string) => {
    if (ttl === value || busy) return;
    setBusy(true);
    setError(null);
    try {
      setValue(
        decodeCache(
          await execute({ operation: "settings.prompt-cache-ttl.update", parameters: { ttl } }),
        ).ttl,
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title={t("provider.settings.cache")}>
      <SettingsCard>
        <SettingsRow
          title={t("provider.settings.promptCache")}
          description={
            error ? (
              <span role="alert" className="provider-settings-error">
                {error}
              </span>
            ) : (
              t("provider.settings.promptCacheDescription")
            )
          }
        >
          {value && (
            <SourceSelect
              label={t("provider.settings.promptCache")}
              value={value}
              disabled={busy}
              options={[
                { id: "5m", name: t("provider.settings.promptCacheDefault") },
                { id: "1h", name: t("provider.settings.promptCacheHour") },
              ]}
              onChange={(ttl) => void change(ttl)}
            />
          )}
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
