import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import {
  botProviderUpdateRequest,
  providerAgent,
  providerModels,
  providerStatus,
  providerAccounts,
  validProviderChoice,
  type BotProviderChoice as Choice,
  type BotProviderAccounts,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { openbot } from "../../state/openbot";
import { BotProviderChoice } from "./BotProviderChoice";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

export function BotProviderSettings({
  environmentId,
  hostId,
  agentId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
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
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const models = providerModels(modelsQuery.data);
  const providers = providerStatus(statusQuery.data);
  const current = providerAgent(agentsQuery.data, agentId);
  const canEdit = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const canAccounts = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.accounts.list" },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [draft, setDraft] = useState<Choice | null>(null);
  const [accounts, setAccounts] = useState<BotProviderAccounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = current?.pendingRuntime ?? current;
  const choice =
    draft ??
    (selected
      ? {
          provider: selected.provider,
          model: selected.model,
          reasoningEffort: selected.reasoningEffort ?? null,
        }
      : null);
  const run = async (request: OpenbotAdminRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await admin({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (request.operation === "provider.accounts.list") {
      const value = providerAccounts(result.value);
      setAccounts(value);
      if (!value) setError("This engine returned unsupported account settings.");
    } else {
      if (request.operation === "agent.update") setDraft(null);
      agentsQuery.refresh();
      if (canAccounts) {
        const refreshed = await admin({
          environmentId,
          input: { hostId, request: { operation: "provider.accounts.list" } },
        });
        if (refreshed._tag === "Success") setAccounts(providerAccounts(refreshed.value));
      }
    }
    setBusy(false);
  };
  const accountProvider = accounts?.providers.find((row) => row.provider === current?.provider);
  const accountOptions = accountProvider?.accounts ?? [];
  const assigned =
    accounts?.agents.find((agent) => agent.agentId === agentId)?.accountId ?? "default";
  return (
    <View className="gap-3 rounded-xl bg-grouped-card p-3">
      <Text>Provider and model</Text>
      {(error || modelsQuery.error || statusQuery.error || agentsQuery.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {error ?? modelsQuery.error ?? statusQuery.error ?? agentsQuery.error}
        </Text>
      )}
      {choice && models && providers ? (
        <>
          {current?.pendingRuntime && (
            <Text className="text-foreground-muted">
              A runtime change is queued until this bot's current work ends.
            </Text>
          )}
          <BotProviderChoice
            value={choice}
            onChange={setDraft}
            models={models}
            providers={providers}
            disabled={busy || !canEdit}
          />
          <Button
            label="Save provider and model"
            disabled={busy || !canEdit || !draft || !validProviderChoice(models, providers, choice)}
            onPress={() => {
              const request = botProviderUpdateRequest(agentId, choice, models);
              if (request) void run(request);
            }}
          />
        </>
      ) : (
        <Text className="text-foreground-muted">
          {agentsQuery.isPending || modelsQuery.isPending || statusQuery.isPending
            ? "Loading provider settings…"
            : "Provider settings are unavailable. Refresh before editing."}
        </Text>
      )}
      <Button
        label="Refresh providers"
        tone="text"
        size="compact"
        onPress={() => {
          modelsQuery.refresh();
          statusQuery.refresh();
          agentsQuery.refresh();
        }}
      />
      <Text>Account for this bot</Text>
      <Button
        label="Load accounts"
        tone="secondary"
        size="compact"
        disabled={busy || !canAccounts}
        onPress={() => void run({ operation: "provider.accounts.list" })}
      />
      {accounts && accountProvider && (
        <>
          <Text className="text-foreground-muted">
            Accounts belong to {current?.provider ?? "this provider"}. Manage sign-ins from Provider
            setup.
          </Text>
          <Button
            label="Provider's own sign-in"
            tone={assigned === "default" ? "primary" : "secondary"}
            disabled={busy || !canAccounts || Boolean(current?.pendingRuntime)}
            onPress={() =>
              void run({ operation: "provider.account.assign", agentId, accountId: null })
            }
          />
          {accountOptions
            .filter((account) => account.id !== "default")
            .map((account) => (
              <Button
                key={account.id}
                label={`${account.label ?? account.email ?? account.id} · ${account.state}`}
                tone={assigned === account.id ? "primary" : "secondary"}
                disabled={
                  busy ||
                  !canAccounts ||
                  account.state !== "connected" ||
                  Boolean(current?.pendingRuntime)
                }
                onPress={() =>
                  void run({ operation: "provider.account.assign", agentId, accountId: account.id })
                }
              />
            ))}
        </>
      )}
    </View>
  );
}
