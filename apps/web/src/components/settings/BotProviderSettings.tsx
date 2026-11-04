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
import { Button } from "../ui/button";

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
    <section aria-label="Bot provider settings" className="space-y-3 rounded-lg border p-4">
      <h4 className="text-sm font-medium">Provider and model</h4>
      {(error || modelsQuery.error || statusQuery.error || agentsQuery.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? modelsQuery.error ?? statusQuery.error ?? agentsQuery.error}
        </p>
      )}
      {choice && models && providers ? (
        <>
          {current?.pendingRuntime && (
            <p className="text-sm text-muted-foreground">
              A runtime change is queued until this bot's current work ends.
            </p>
          )}
          <BotProviderChoice
            value={choice}
            onChange={setDraft}
            models={models}
            providers={providers}
            disabled={busy || !canEdit}
          />
          <Button
            size="sm"
            disabled={busy || !canEdit || !draft || !validProviderChoice(models, providers, choice)}
            onClick={() => {
              const request = botProviderUpdateRequest(agentId, choice, models);
              if (request) void run(request);
            }}
          >
            Save provider and model
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {agentsQuery.isPending || modelsQuery.isPending || statusQuery.isPending
            ? "Loading provider settings…"
            : "Provider settings are unavailable. Refresh before editing."}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          modelsQuery.refresh();
          statusQuery.refresh();
          agentsQuery.refresh();
        }}
      >
        Refresh providers
      </Button>
      <div className="space-y-2">
        <h5 className="text-sm font-medium">Account for this bot</h5>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canAccounts}
          onClick={() => void run({ operation: "provider.accounts.list" })}
        >
          Load accounts
        </Button>
        {accounts && accountProvider && (
          <>
            <p className="text-sm text-muted-foreground">
              Accounts belong to {current?.provider ?? "this provider"}. Manage sign-ins from
              Provider setup.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={assigned === "default" ? "secondary" : "outline"}
                size="sm"
                disabled={busy || !canAccounts || Boolean(current?.pendingRuntime)}
                onClick={() =>
                  void run({ operation: "provider.account.assign", agentId, accountId: null })
                }
              >
                Provider's own sign-in
              </Button>
              {accountOptions
                .filter((account) => account.id !== "default")
                .map((account) => (
                  <Button
                    key={account.id}
                    variant={assigned === account.id ? "secondary" : "outline"}
                    size="sm"
                    disabled={
                      busy ||
                      !canAccounts ||
                      account.state !== "connected" ||
                      Boolean(current?.pendingRuntime)
                    }
                    onClick={() =>
                      void run({
                        operation: "provider.account.assign",
                        agentId,
                        accountId: account.id,
                      })
                    }
                  >
                    {account.label ?? account.email ?? account.id} · {account.state}
                  </Button>
                ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
