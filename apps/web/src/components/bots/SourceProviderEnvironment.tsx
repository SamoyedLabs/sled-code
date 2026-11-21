/* oxlint-disable shadcn/no-unknown-classes -- Source usage selectors are defined in AccountUsage.css. */
import { SourceAgentAvatarHost } from "./SourceAgentAvatar";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useAtomValue, RegistryContext } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { type EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { readPreparedConnection } from "../../state/session";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { providerAgent } from "@t3tools/client-runtime/openbot/presentation";
import { useOpenbotProviderData } from "./upstream/provider/useOpenbotProviderData";
import { BotModelPicker } from "./BotModelPicker";
import { AccountUsageDetails } from "./upstream/provider/AccountUsageDetails";
import { accountUsageProviderRows } from "./upstream/provider/account-usage-view";
import { isReasoningEffort } from "./upstream/provider/types";
import { T, useGT } from "gt-react";
const decodeAdmin = Schema.decodeUnknownResult(OpenbotAdminRequest);
const decodeFast = Schema.decodeUnknownResult(
  Schema.Struct({ fastMode: Schema.NullOr(Schema.Boolean) }),
);
const Context = createContext<ReturnType<typeof useOpenbotProviderData> | null>(null);
export function SourceProviderHost({
  environmentId,
  hostId,
  children,
}: {
  environmentId: EnvironmentId;
  hostId: string | null;
  children: ReactNode;
}) {
  return hostId ? (
    <Ready key={`${environmentId}:${hostId}`} environmentId={environmentId} hostId={hostId}>
      {children}
    </Ready>
  ) : (
    children
  );
}
function Ready({
  environmentId,
  hostId,
  children,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  children: ReactNode;
}) {
  const data = useOpenbotProviderData(environmentId, hostId);
  return (
    <SourceAgentAvatarHost environmentId={environmentId} hostId={hostId}>
      <Context.Provider value={data}>{children}</Context.Provider>
    </SourceAgentAvatarHost>
  );
}
export const useSourceProviderData = () => useContext(Context);
export function SourceModelPicker({
  environmentId,
  hostId,
  agentId,
  onManage,
  variant = "pill",
  disabled = false,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  onManage?: (() => void) | undefined;
  variant?: "pill" | "field";
  disabled?: boolean;
}) {
  const gt = useGT();
  const data = useContext(Context),
    registry = useContext(RegistryContext);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    lock = useRef(false);
  const details = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const fastCap = settingsCapabilities(compatibility.data).includes("agent-fast-mode-v1");
  const fastRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.agent-fast-mode.settings", parameters: { agentId } },
    }),
  );
  const fast = useEnvironmentQuery(
    fastCap && fastRead
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.agent-fast-mode.settings", parameters: { agentId } },
          },
        })
      : null,
  );
  const canChange = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "agent.update", agentId, input: {} },
    }),
  );
  const current = providerAgent(details.data, agentId);
  const run = async (inputs: readonly unknown[]) => {
    if (lock.current) return;
    const connection = readPreparedConnection(environmentId);
    if (!connection) return;
    const requests = inputs.map((input) => decodeAdmin(input));
    if (requests.some((request) => Result.isFailure(request))) {
      setError(gt("This host cannot accept that provider setting."));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      for (const request of requests) {
        if (!Result.isSuccess(request)) return;
        if (
          readPreparedConnection(environmentId) !== connection ||
          !registry.get(
            openbot.adminToHost.permissionAtom(environmentId, { hostId, request: request.success }),
          )
        )
          throw Error("Provider access changed.");
        const result = await admin({ environmentId, input: { hostId, request: request.success } });
        if (result._tag === "Failure")
          throw Error(
            "Provider change was refused or its outcome is unknown. Refresh before retrying.",
          );
      }
    });
    if (settled._tag === "Failure" && readPreparedConnection(environmentId) === connection) {
      const failure = squashAtomCommandFailure(settled);
      setError(
        failure instanceof Error ? failure.message : gt("Provider change could not be confirmed."),
      );
    }
    lock.current = false;
    if (readPreparedConnection(environmentId) === connection) {
      setBusy(false);
      details.refresh();
      fast.refresh();
      data?.refresh();
    }
  };
  if (!data?.status || !current)
    return (
      <span className="text-xs text-muted-foreground">
        {data?.loading ? gt("Loading model…") : gt("Model unavailable")}
      </span>
    );
  const assigned = data.accounts?.agents.find((row) => row.agentId === agentId)?.accountId ?? null;
  const effort = isReasoningEffort(current.reasoningEffort) ? current.reasoningEffort : undefined;
  const parsedFast = decodeFast(fast.data),
    fastValue = Result.isSuccess(parsedFast) ? parsedFast.success.fastMode : undefined;
  return (
    <div className="contents">
      <BotModelPicker
        scope={JSON.stringify([environmentId, hostId])}
        variant={variant}
        provider={current.provider}
        value={current.model}
        modelOptions={data.modelOptions}
        agentStatus={data.status}
        {...(effort ? { reasoningEffort: effort } : {})}
        disabled={disabled || busy || !canChange}
        {...(!canChange
          ? { disabledReason: gt("This connection cannot change the agent model.") }
          : {})}
        runtimeStatuses={data.runtimeStatuses}
        customProviders={data.customProviders}
        customAgents={data.customAgents}
        accountChoice={!!data.accounts}
        providerAccountId={assigned}
        accountUsage={data.usage}
        onChange={(model, provider, accountId, reasoningEffort) =>
          void run([
            {
              operation: "agent.update",
              agentId,
              input: { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
            },
            ...(accountId !== undefined && accountId !== assigned
              ? [{ operation: "provider.account.assign", agentId, accountId }]
              : []),
          ])
        }
        onReasoningEffortChange={(reasoningEffort) =>
          void run([{ operation: "agent.update", agentId, input: { reasoningEffort } }])
        }
        {...(fastCap && fastValue !== undefined
          ? {
              fastMode: fastValue ?? false,
              onFastModeChange: (fastMode: boolean) =>
                void run([
                  {
                    operation: "settings.agent-fast-mode.update",
                    parameters: { agentId, fastMode },
                  },
                ]),
            }
          : {})}
        {...(onManage
          ? {
              onManageProviders: onManage,
              onAddCustomProvider: onManage,
              onConnectProvider: onManage,
            }
          : {})}
        onDownloadProvider={(provider) =>
          run([{ operation: "provider.runtimes.download", provider }])
        }
        onCancelProviderDownload={(provider) =>
          run([{ operation: "provider.runtimes.cancel", provider }])
        }
      />
      {error && (
        <span role="alert" className="max-w-48 text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export function SourceUsageDetails() {
  const gt = useGT();
  const data = useContext(Context);
  if (!data) return null;
  return (
    <section className="account-usage-popover" aria-label={gt("Provider limits")}>
      <AccountUsageDetails
        rows={accountUsageProviderRows(data.usage, data.status?.providers)}
        loading={data.loading}
        error={data.error}
        refreshActive={data.loading}
        refreshDisabled={data.loading}
        onRefresh={data.refresh}
        title={
          <h2 className="account-usage-popover-title">
            <T>Plan limits</T>
          </h2>
        }
      />
    </section>
  );
}
