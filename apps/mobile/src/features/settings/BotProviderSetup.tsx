import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Linking, View } from "react-native";
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
import * as Dialog from "../../components/ui/Dialog";
import { BotProviderChoice } from "./BotProviderChoice";
import { BotCustomProviders } from "./BotCustomProviders";
import { BotModelVisibility } from "./BotModelVisibility";
import { BotConnections } from "./BotConnections";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { ControlPill } from "../../components/ui/ControlPill";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";

export function BotProviderSetup({
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
  const [privateRevision, setPrivateRevision] = useState(0);
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
        setPrivateRevision((value) => value + 1);
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
  const remove = (signOut: boolean) => {
    Dialog.alert(
      signOut ? "Sign provider out?" : "Remove account?",
      signOut
        ? "Its bots may need to reconnect before continuing."
        : "Its bots will move to the provider's own sign-in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: signOut ? "Sign out" : "Remove",
          style: "destructive",
          onPress: () =>
            void runMany([
              signOut
                ? { operation: "provider.signOut", provider }
                : { operation: "provider.account.remove", provider, accountId },
              { operation: "provider.accounts.list" },
            ]),
        },
      ],
    );
  };
  const relay = setup.relay;
  const challenge = setup.codeSignIn;
  const hostSignIn = setup.hostSignIn;
  const openPage = (address: string) =>
    void Linking.openURL(address).catch(() => setError("Could not open the sign-in page."));
  return (
    <View className="gap-4">
      <Text className="text-foreground-muted">
        Choose a provider to manage its sign-in and accounts on this bot engine.
      </Text>
      {!allowed && (
        <Text className="text-foreground-muted">
          Provider management and settings permissions are required to change this setup.
        </Text>
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
            setPrivateRevision((value) => value + 1);
          }
        }}
      />
      <Button
        label="Load setup"
        tone="secondary"
        disabled={busy || !allowed || active}
        onPress={load}
      />
      <Button
        label="Refresh providers"
        tone="text"
        size="compact"
        onPress={() => {
          modelsQuery.refresh();
          statusQuery.refresh();
        }}
      />
      {(error || setup.error || modelsQuery.error || statusQuery.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {error ?? setup.error ?? modelsQuery.error ?? statusQuery.error}
        </Text>
      )}
      {provider && (
        <>
          {capability.relay && (
            <Button
              label="Sign in on this device"
              disabled={busy || !allowed || active}
              onPress={() => run({ operation: "provider.signInRelay.start", provider })}
            />
          )}
          {capability.codeSignIn && (
            <Button
              label="Sign in with a code"
              tone="secondary"
              disabled={busy || !allowed || active}
              onPress={() => run({ operation: "provider.codeLogin.start", provider })}
            />
          )}
          {capability.hostSignIn && (
            <Button
              label="Sign in on the host"
              tone="secondary"
              disabled={busy || !allowed || active}
              onPress={() => run({ operation: "provider.hostSignIn.start", provider })}
            />
          )}
          {capability.signOut && (
            <Button
              label="Sign out"
              tone="secondary"
              disabled={busy || !allowed || active}
              onPress={() => remove(true)}
            />
          )}
          {relay && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              <Text>
                {relay.status?.result
                  ? (relay.status.result.error ?? "Sign-in completed.")
                  : "Open the provider's sign-in page, then check its status."}
              </Text>
              {relay.status?.authorizeUrl && (
                <Button
                  label="Open sign-in page"
                  tone="text"
                  onPress={() => {
                    if (relay.status?.authorizeUrl) openPage(relay.status.authorizeUrl);
                  }}
                />
              )}
              {!relay.status?.result && (
                <Button
                  label="Check sign-in"
                  tone="secondary"
                  disabled={busy}
                  onPress={() =>
                    run({ operation: "provider.signInRelay.status", flowId: relay.flowId })
                  }
                />
              )}
              {relay.status?.callback && !relay.status.result && (
                <>
                  <Text>Return address from sign-in</Text>
                  <AppTextInput
                    key={`callback:${privateRevision}`}
                    accessibilityLabel="Return address from sign-in"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    defaultValue=""
                    onChangeText={setCallback}
                    maxLength={8192}
                    editable={!busy}
                    className="min-h-12 rounded-xl bg-background p-3"
                  />
                  <Text className="text-foreground-muted">
                    If the browser cannot reach the return page, copy its full address here.
                  </Text>
                  <Button
                    label="Complete sign-in"
                    disabled={busy || !callback.trim()}
                    onPress={() => {
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
                  />
                </>
              )}
            </View>
          )}
          {challenge && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              {challenge.kind === "connected" || providerState === "available" ? (
                <Text>Provider is signed in.</Text>
              ) : (
                <>
                  <Button
                    label="Open sign-in page"
                    tone="text"
                    onPress={() => openPage(challenge.verificationUrl)}
                  />
                  {challenge.kind === "code" && <Text selectable>Code: {challenge.userCode}</Text>}
                  <Text className="text-foreground-muted">
                    Expires: {new Date(challenge.expiresAt).toLocaleString()}
                  </Text>
                  {challenge.kind === "paste" && (
                    <>
                      <Text>Code from sign-in page</Text>
                      <AppTextInput
                        key={`code:${privateRevision}`}
                        accessibilityLabel="Code from sign-in page"
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        defaultValue=""
                        maxLength={2048}
                        onChangeText={setCode}
                        editable={!busy}
                        className="min-h-12 rounded-xl bg-background p-3"
                      />
                      <Button
                        label="Submit sign-in code"
                        disabled={busy || !code.trim()}
                        onPress={() =>
                          run({
                            operation: "provider.codeLogin.submit",
                            provider,
                            code: code.trim(),
                          })
                        }
                      />
                    </>
                  )}
                  <Button
                    label="Refresh sign-in status"
                    tone="secondary"
                    onPress={() => {
                      modelsQuery.refresh();
                      statusQuery.refresh();
                    }}
                  />
                </>
              )}
            </View>
          )}
          {hostSignIn && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              <Text>
                {hostSignIn.result
                  ? (hostSignIn.result.error ?? "Sign-in completed.")
                  : "Continue in the browser on the bot host."}
              </Text>
              <Button
                label="Check host sign-in"
                tone="secondary"
                disabled={busy}
                onPress={() =>
                  run({
                    operation:
                      hostSignIn.kind === "account"
                        ? "provider.account.signIn.status"
                        : "provider.hostSignIn.status",
                    provider,
                  })
                }
              />
              {hostSignIn.tabId && (
                <Button
                  label="Show sign-in tab on host"
                  tone="secondary"
                  disabled={busy}
                  onPress={() => run({ operation: "browser.activate", tabId: hostSignIn.tabId! })}
                />
              )}
            </View>
          )}
          {active && (
            <Button label="Cancel sign-in" tone="secondary" disabled={busy} onPress={cancel} />
          )}
          {capability.apiKey && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              <Text>API key</Text>
              <Text className="text-foreground-muted">
                {setup.keyState ? `Key status: ${setup.keyState}` : "The saved key is never shown."}
              </Text>
              <AppTextInput
                key={`key:${privateRevision}`}
                accessibilityLabel="Provider API key"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                defaultValue=""
                maxLength={512}
                onChangeText={setApiKey}
                editable={!busy && allowed && !active}
                className="min-h-12 rounded-xl bg-background p-3"
              />
              <Button
                label="Save key"
                disabled={busy || !allowed || active || !apiKey.trim()}
                onPress={() =>
                  void runMany([
                    { operation: "provider.apiKey.set", provider, key: apiKey.trim() },
                    { operation: "provider.apiKey.state", provider },
                  ])
                }
              />
              <Button
                label="Clear key"
                tone="secondary"
                disabled={busy || !allowed || active}
                onPress={() =>
                  void runMany([
                    { operation: "provider.apiKey.clear", provider },
                    { operation: "provider.apiKey.state", provider },
                  ])
                }
              />
              <Button
                label="Check key status"
                tone="text"
                disabled={busy || !allowed}
                onPress={() => run({ operation: "provider.apiKey.state", provider })}
              />
            </View>
          )}
          {capability.managed && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              <Text>
                Runtime: {runtime?.phase}
                {runtime?.version ? ` · ${runtime.version}` : ""}
                {runtime?.message ? ` · ${runtime.message}` : ""}
              </Text>
              <Button
                label="Download or update runtime"
                tone="secondary"
                disabled={busy || !allowed || active}
                onPress={() => run({ operation: "provider.runtimes.download", provider })}
              />
              <Button
                label="Cancel download"
                tone="secondary"
                disabled={busy || !allowed || runtime?.phase !== "downloading"}
                onPress={() => run({ operation: "provider.runtimes.cancel", provider })}
              />
              <Button
                label="Check runtime updates"
                tone="text"
                disabled={busy || !allowed}
                onPress={() => run({ operation: "provider.runtimes.check" })}
              />
            </View>
          )}
          {capability.multipleAccounts && (
            <View className="gap-2 rounded-xl bg-grouped-card p-3">
              <Text>Accounts</Text>
              <Menu
                title="Provider account"
                accessibilityLabel="Choose provider account"
                actions={accountOptions.map((account) => ({
                  id: account.id,
                  title: `${account.label ?? account.email ?? (account.id === "default" ? "Provider's own sign-in" : account.id)} · ${account.state}`,
                  state: account.id === accountId ? "on" : undefined,
                  attributes: { disabled: busy || active },
                }))}
                onPressAction={({ nativeEvent }) => {
                  if (busy || active) return;
                  const selected = accountOptions.find(
                    (account) => account.id === nativeEvent.event,
                  );
                  if (selected) {
                    setAccountId(selected.id);
                    setLabel(selected.label ?? "");
                  }
                }}
              >
                <ControlPill
                  label={
                    accountOptions.find((account) => account.id === accountId)?.label ??
                    accountOptions.find((account) => account.id === accountId)?.email ??
                    "Choose an account"
                  }
                  variant="pill"
                  disabled={busy || active}
                />
              </Menu>
              <Button
                label="Add account"
                tone="secondary"
                disabled={busy || !allowed || active}
                onPress={() => reconnectAccount(null)}
              />
              {accountId && (
                <>
                  <Text>Account label</Text>
                  <AppTextInput
                    key={`label:${provider}:${accountId}`}
                    accessibilityLabel="Account label"
                    defaultValue={label}
                    onChangeText={setLabel}
                    maxLength={60}
                    editable={!busy && allowed && !active}
                    className="min-h-12 rounded-xl bg-background p-3"
                  />
                  <Button
                    label="Save label"
                    disabled={busy || !allowed || active}
                    onPress={() =>
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
                  />
                  <Button
                    label="Reconnect account"
                    tone="secondary"
                    disabled={busy || !allowed || active}
                    onPress={() => reconnectAccount(accountId)}
                  />
                  {accountId !== "default" && (
                    <Button
                      label="Remove account"
                      tone="secondary"
                      disabled={busy || !allowed || active}
                      onPress={() => remove(false)}
                    />
                  )}
                </>
              )}
            </View>
          )}
          {setup.defaults && (
            <Text className="text-foreground-muted">
              Engine default: {setup.defaults.provider ?? "Host default"}
              {setup.defaults.model ? ` · ${setup.defaults.model}` : ""}
            </Text>
          )}
          <Button
            label="Set selected model as engine default"
            tone="secondary"
            disabled={busy || !allowed || active || !choice.model}
            onPress={() =>
              run({ operation: "provider.default.update", provider, model: choice.model || null })
            }
          />
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
    </View>
  );
}
