import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  EMPTY_BOT_PROVIDER_CHOICE,
  EMPTY_PROVIDER_SETUP,
  providerModels,
  providerStatus,
  providerAdminRequest,
  providerSetupCapabilities,
  providerSetupResult,
  providerRelayCallbackQuery,
  type BotProviderChoice as Choice,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { openbot } from "../../state/openbot";
import { requestConfirmDialog } from "../../confirmDialog";
import { BotProviderChoice } from "./BotProviderChoice";
import { BotCustomProviders } from "./BotCustomProviders";
import { BotModelVisibility } from "./BotModelVisibility";
import { BotConnections } from "./BotConnections";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function BotProviderSetup(props: { environmentId: EnvironmentId; hostId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="space-y-3">
      <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Close provider setup" : "Provider setup"}
      </Button>
      {expanded && <ProviderSetupPanel {...props} />}
    </section>
  );
}

function ProviderSetupPanel({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const modelsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.models" } },
    }),
  );
  const statusQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.status" } },
    }),
  );
  const models = providerModels(modelsQuery.data);
  const providers = providerStatus(statusQuery.data);
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.runtimes.check" },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [choice, setChoice] = useState<Choice>(EMPTY_BOT_PROVIDER_CHOICE);
  const [setup, setSetup] = useState(EMPTY_PROVIDER_SETUP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [code, setCode] = useState("");
  const [callback, setCallback] = useState("");
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const lock = useRef(false);
  const provider = choice.provider;
  const capability = providerSetupCapabilities(provider, setup.runtimes, setup.accounts);
  const runtime = setup.runtimes?.providers.find((row) => row.id === provider);
  const accountOptions =
    setup.accounts?.providers.find((row) => row.provider === provider)?.accounts ?? [];
  const relayId = setup.relay?.status?.result ? null : (setup.relay?.flowId ?? null);
  const providerState = providers?.find((row) => row.id === provider)?.state;
  const codeProvider =
    setup.codeSignIn && setup.codeSignIn.kind !== "connected" && providerState !== "available"
      ? provider
      : null;
  const hostFlow = setup.hostSignIn?.result ? null : setup.hostSignIn;
  const hostFlowKind = hostFlow?.kind;
  const hostFlowProvider = hostFlow?.provider;
  const releaseSignIn = useEffectEvent(
    (ownerEnvironmentId: EnvironmentId, ownerHostId: string, requests: readonly unknown[]) => {
      for (const input of requests) {
        const request = providerAdminRequest(input);
        if (request)
          void admin({
            environmentId: ownerEnvironmentId,
            input: { hostId: ownerHostId, request },
          });
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel host-owned sign-in resources when this setup view releases them.
  useEffect(
    () => () => {
      const requests: unknown[] = [];
      if (relayId) requests.push({ operation: "provider.signInRelay.cancel", flowId: relayId });
      if (codeProvider)
        requests.push({ operation: "provider.codeLogin.cancel", provider: codeProvider });
      if (hostFlowProvider)
        requests.push({
          operation:
            hostFlowKind === "account"
              ? "provider.account.signIn.cancel"
              : "provider.hostSignIn.cancel",
          provider: hostFlowProvider,
        });
      releaseSignIn(environmentId, hostId, requests);
    },
    [environmentId, hostId, relayId, codeProvider, hostFlowKind, hostFlowProvider],
  );
  const runMany = async (requests: readonly unknown[]) => {
    if (lock.current || !allowed) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let next = setup;
    for (const input of requests) {
      const request = providerAdminRequest(input);
      if (!request) {
        setError("This provider does not support that setup action.");
        break;
      }
      const result = await admin({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") {
        setError(String(squashAtomCommandFailure(result)));
        break;
      }
      next = providerSetupResult(next, request, result.value);
      if (next.error) break;
      if (
        [
          "provider.apiKey.set",
          "provider.codeLogin.submit",
          "provider.signInRelay.complete",
        ].includes(request.operation)
      ) {
        setApiKey("");
        setCode("");
        setCallback("");
      }
      if (
        (request.operation === "provider.signInRelay.start" ||
          request.operation === "provider.account.signInRelay.start") &&
        next.relay
      ) {
        const statusRequest = {
          operation: "provider.signInRelay.status" as const,
          flowId: next.relay.flowId,
        };
        const status = await admin({ environmentId, input: { hostId, request: statusRequest } });
        if (status._tag === "Success")
          next = providerSetupResult(next, statusRequest, status.value);
      }
    }
    setSetup(next);
    modelsQuery.refresh();
    statusQuery.refresh();
    setBusy(false);
    lock.current = false;
  };
  const run = (request: unknown) => void runMany([request]);
  const load = () =>
    void runMany([
      { operation: "provider.accounts.list" },
      { operation: "provider.runtimes.status" },
      { operation: "provider.default.read" },
    ]);
  const active = Boolean(relayId || codeProvider || hostFlowProvider);
  const cancel = () => {
    if (relayId) run({ operation: "provider.signInRelay.cancel", flowId: relayId });
    else if (codeProvider) run({ operation: "provider.codeLogin.cancel", provider: codeProvider });
    else if (hostFlowProvider)
      run({
        operation:
          hostFlowKind === "account"
            ? "provider.account.signIn.cancel"
            : "provider.hostSignIn.cancel",
        provider: hostFlowProvider,
      });
  };
  const reconnectAccount = (selected: string | null) =>
    run(
      capability.accountRelay
        ? { operation: "provider.account.signInRelay.start", provider, accountId: selected }
        : { operation: "provider.account.signIn.start", provider, accountId: selected },
    );
  const remove = async (signOut: boolean) => {
    const question = signOut
      ? "Sign this bot provider out? Its bots may need to reconnect before continuing."
      : "Remove this account? Its bots will move to the provider's own sign-in.";
    const confirmed =
      (await requestConfirmDialog(question, { variant: "destructive" })) ??
      window.confirm(question);
    if (confirmed)
      void runMany([
        signOut
          ? { operation: "provider.signOut", provider }
          : { operation: "provider.account.remove", provider, accountId },
        { operation: "provider.accounts.list" },
      ]);
  };
  const relay = setup.relay;
  const challenge = setup.codeSignIn;
  const hostSignIn = setup.hostSignIn;
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h4 className="text-sm font-medium">Bot providers</h4>
      <p className="text-sm text-muted-foreground">
        Choose a provider to manage its sign-in and accounts on this bot engine.
      </p>
      {!allowed && (
        <p className="text-sm text-muted-foreground">
          Provider management and settings permissions are required to change this setup.
        </p>
      )}
      <BotProviderChoice
        value={choice}
        models={models ?? []}
        providers={providers ?? []}
        disabled={busy || active}
        onChange={(value) => {
          setChoice(value);
          if (value.provider !== provider) {
            setAccountId("");
            setLabel("");
            setSetup(EMPTY_PROVIDER_SETUP);
            setApiKey("");
            setCode("");
            setCallback("");
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || !allowed || active} onClick={load}>
          Load setup
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            modelsQuery.refresh();
            statusQuery.refresh();
          }}
        >
          Refresh providers
        </Button>
      </div>
      {(error || setup.error || modelsQuery.error || statusQuery.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? setup.error ?? modelsQuery.error ?? statusQuery.error}
        </p>
      )}
      {provider && (
        <>
          <div className="flex flex-wrap gap-2">
            {capability.relay && (
              <Button
                size="sm"
                disabled={busy || !allowed || active}
                onClick={() => run({ operation: "provider.signInRelay.start", provider })}
              >
                Sign in in this browser
              </Button>
            )}
            {capability.codeSignIn && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !allowed || active}
                onClick={() => run({ operation: "provider.codeLogin.start", provider })}
              >
                Sign in with a code
              </Button>
            )}
            {capability.hostSignIn && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !allowed || active}
                onClick={() => run({ operation: "provider.hostSignIn.start", provider })}
              >
                Sign in on the host
              </Button>
            )}
            {capability.signOut && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !allowed || active}
                onClick={() => void remove(true)}
              >
                Sign out
              </Button>
            )}
          </div>
          {relay && (
            <div className="space-y-2">
              <p className="text-sm">
                {relay.status?.result
                  ? (relay.status.result.error ?? "Sign-in completed.")
                  : "Open the provider's sign-in page, then check its status."}
              </p>
              {relay.status?.authorizeUrl && (
                <a
                  href={relay.status.authorizeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  Open sign-in page
                </a>
              )}
              {!relay.status?.result && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run({ operation: "provider.signInRelay.status", flowId: relay.flowId })
                  }
                >
                  Check sign-in
                </Button>
              )}
              {relay.status?.callback && !relay.status.result && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Return address from sign-in</span>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={callback}
                      onChange={(event) => setCallback(event.target.value)}
                      maxLength={8192}
                      disabled={busy}
                    />
                  </label>
                  <p className="text-sm text-muted-foreground">
                    If the browser cannot reach the return page, copy its full address here.
                  </p>
                  <Button
                    size="sm"
                    disabled={busy || !callback.trim()}
                    onClick={() => {
                      const query = providerRelayCallbackQuery(callback, relay.status!.callback!);
                      if (query === null)
                        setError(
                          "That address does not match this sign-in. Copy the full return address from the browser.",
                        );
                      else
                        run({
                          operation: "provider.signInRelay.complete",
                          flowId: relay.flowId,
                          query,
                        });
                    }}
                  >
                    Complete sign-in
                  </Button>
                </>
              )}
            </div>
          )}
          {challenge && (
            <div className="space-y-2">
              {challenge.kind === "connected" || providerState === "available" ? (
                <p className="text-sm">Provider is signed in.</p>
              ) : (
                <>
                  <a
                    href={challenge.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline"
                  >
                    Open sign-in page
                  </a>
                  {challenge.kind === "code" && (
                    <p className="text-sm">
                      Code: <code>{challenge.userCode}</code>
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Expires: {new Date(challenge.expiresAt).toLocaleString()}
                  </p>
                  {challenge.kind === "paste" && (
                    <>
                      <label className="block space-y-1 text-sm">
                        <span>Code from sign-in page</span>
                        <Input
                          type="password"
                          autoComplete="off"
                          value={code}
                          maxLength={2048}
                          onChange={(event) => setCode(event.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <Button
                        size="sm"
                        disabled={busy || !code.trim()}
                        onClick={() =>
                          run({
                            operation: "provider.codeLogin.submit",
                            provider,
                            code: code.trim(),
                          })
                        }
                      >
                        Submit sign-in code
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      modelsQuery.refresh();
                      statusQuery.refresh();
                    }}
                  >
                    Refresh sign-in status
                  </Button>
                </>
              )}
            </div>
          )}
          {hostSignIn && (
            <div className="space-y-2">
              <p className="text-sm">
                {hostSignIn.result
                  ? (hostSignIn.result.error ?? "Sign-in completed.")
                  : "Continue in the browser on the bot host."}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run({
                    operation:
                      hostSignIn.kind === "account"
                        ? "provider.account.signIn.status"
                        : "provider.hostSignIn.status",
                    provider,
                  })
                }
              >
                Check host sign-in
              </Button>
              {hostSignIn.tabId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => run({ operation: "browser.activate", tabId: hostSignIn.tabId! })}
                >
                  Show sign-in tab on host
                </Button>
              )}
            </div>
          )}
          {active && (
            <Button variant="outline" size="sm" disabled={busy} onClick={cancel}>
              Cancel sign-in
            </Button>
          )}
          {capability.apiKey && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">API key</h5>
              <p className="text-sm text-muted-foreground">
                {setup.keyState ? `Key status: ${setup.keyState}` : "The saved key is never shown."}
              </p>
              <Input
                aria-label="Provider API key"
                type="password"
                autoComplete="off"
                value={apiKey}
                maxLength={512}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={busy || !allowed || active}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !allowed || active || !apiKey.trim()}
                  onClick={() =>
                    void runMany([
                      { operation: "provider.apiKey.set", provider, key: apiKey.trim() },
                      { operation: "provider.apiKey.state", provider },
                    ])
                  }
                >
                  Save key
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !allowed || active}
                  onClick={() =>
                    void runMany([
                      { operation: "provider.apiKey.clear", provider },
                      { operation: "provider.apiKey.state", provider },
                    ])
                  }
                >
                  Clear key
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !allowed}
                  onClick={() => run({ operation: "provider.apiKey.state", provider })}
                >
                  Check key status
                </Button>
              </div>
            </div>
          )}
          {capability.managed && (
            <div className="space-y-2">
              <p className="text-sm">
                Runtime: {runtime?.phase}
                {runtime?.version ? ` · ${runtime.version}` : ""}
                {runtime?.message ? ` · ${runtime.message}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !allowed || active}
                  onClick={() => run({ operation: "provider.runtimes.download", provider })}
                >
                  Download or update runtime
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !allowed}
                  onClick={() => run({ operation: "provider.runtimes.cancel", provider })}
                >
                  Cancel download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !allowed}
                  onClick={() => run({ operation: "provider.runtimes.check" })}
                >
                  Check runtime updates
                </Button>
              </div>
            </div>
          )}
          {capability.multipleAccounts && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">Accounts</h5>
              <Select
                value={accountId || null}
                disabled={busy || active}
                onValueChange={(id) => {
                  if (id) {
                    setAccountId(id);
                    setLabel(accountOptions.find((account) => account.id === id)?.label ?? "");
                  }
                }}
              >
                <SelectTrigger aria-label="Provider account">
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label ??
                        account.email ??
                        (account.id === "default" ? "Provider's own sign-in" : account.id)}{" "}
                      · {account.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !allowed || active}
                onClick={() => reconnectAccount(null)}
              >
                Add account
              </Button>
              {accountId && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Account label</span>
                    <Input
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      maxLength={60}
                      disabled={busy || !allowed || active}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !allowed || active}
                      onClick={() =>
                        void runMany([
                          {
                            operation: "provider.account.rename",
                            provider,
                            accountId,
                            label: label.trim() || null,
                          },
                          { operation: "provider.accounts.list" },
                        ])
                      }
                    >
                      Save label
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !allowed || active}
                      onClick={() => reconnectAccount(accountId)}
                    >
                      Reconnect account
                    </Button>
                    {accountId !== "default" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !allowed || active}
                        onClick={() => void remove(false)}
                      >
                        Remove account
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {setup.defaults && (
            <p className="text-sm text-muted-foreground">
              Engine default: {setup.defaults.provider ?? "Host default"}
              {setup.defaults.model ? ` · ${setup.defaults.model}` : ""}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !allowed || active || !choice.model}
            onClick={() =>
              run({ operation: "provider.default.update", provider, model: choice.model || null })
            }
          >
            Set selected model as engine default
          </Button>
          <BotModelVisibility
            key={`${hostId}:${provider}`}
            environmentId={environmentId}
            hostId={hostId}
            provider={provider}
            onChange={() => {
              modelsQuery.refresh();
              statusQuery.refresh();
            }}
          />
        </>
      )}
      <BotConnections environmentId={environmentId} hostId={hostId} />
      <BotCustomProviders
        key={hostId}
        environmentId={environmentId}
        hostId={hostId}
        onChange={() => {
          modelsQuery.refresh();
          statusQuery.refresh();
        }}
      />
    </div>
  );
}
