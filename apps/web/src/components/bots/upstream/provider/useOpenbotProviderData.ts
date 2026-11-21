import { useContext, useEffect, useEffectEvent, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import {
  providerAccounts,
  type BotProviderAccounts,
} from "@t3tools/client-runtime/openbot/presentation";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
import { isAgentProvider } from "./identity";
import {
  readAccountUsage,
  readAgentStatus,
  readModelOptions,
  type AccountUsage,
  type ProviderRuntimeStatus,
  type CustomProviderSummary,
  type CustomAgentSummary,
} from "./types";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
const RuntimeList = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      phase: Schema.Literals([
        "not-downloaded",
        "downloading",
        "finishing",
        "ready",
        "download-error",
      ]),
      progress: Schema.NullOr(Schema.Number),
      message: Schema.NullOr(Schema.String),
      version: Schema.NullOr(Schema.String),
      availableVersion: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodeRuntimes = Schema.decodeUnknownResult(RuntimeList);
function providerRuntimes(value: unknown) {
  const parsed = decodeRuntimes(value);
  return Result.isSuccess(parsed) ? parsed.success : null;
}
const EndpointList = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    harness: Schema.optional(Schema.Literals(["opencode", "pi"])),
  }),
);
const AgentList = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }));
const decodeEndpoints = Schema.decodeUnknownResult(EndpointList);
const decodeAgents = Schema.decodeUnknownResult(AgentList);
const decodeListings = Schema.decodeUnknownResult(
  Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        provider: Schema.String,
        id: Schema.String,
        listing: Schema.Literals(["new", "older"]),
      }),
    ),
  }),
);
const reads = [
  "provider.accounts.list",
  "provider.accounts.usage",
  "provider.runtimes.status",
  "provider.custom.list",
  "provider.customAgent.list",
] as const;
type Extra = {
  accounts: BotProviderAccounts | null;
  usage: AccountUsage | null;
  runtimes: Partial<Record<import("./identity").AgentProviderId, ProviderRuntimeStatus>>;
  customProviders: CustomProviderSummary[];
  customAgents: CustomAgentSummary[];
};
const empty: Extra = {
  accounts: null,
  usage: null,
  runtimes: {},
  customProviders: [],
  customAgents: [],
};
/** All reads stay on the guarded host port; an account-admin denial never hides public sign-in usage. */
export function useOpenbotProviderData(environmentId: EnvironmentId, hostId: string) {
  const registry = useContext(RegistryContext);
  const connection = usePreparedConnection(environmentId);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.accounts.list" },
    }),
  );
  const canUsage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.accounts.usage" },
    }),
  );
  const canRuntimes = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.runtimes.status" },
    }),
  );
  const canCustom = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.custom.list" },
    }),
  );
  const canAgents = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.customAgent.list" },
    }),
  );
  const access = [allowed, canUsage, canRuntimes, canCustom, canAgents].join(":");
  const listingQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "provider.modelVisibility.listing" } },
    }),
  );
  const usageQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "workspace.usage" } },
    }),
  );
  const statusQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.status" } },
    }),
  );
  const modelsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.models" } },
    }),
  );
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{
    environmentId: EnvironmentId;
    hostId: string;
    connection: ReturnType<typeof readPreparedConnection>;
    extra: Extra;
    access: string;
  } | null>(null);
  const load = useEffectEvent(async (cancelled: () => boolean) => {
    const prepared = readPreparedConnection(environmentId);
    if (!prepared) return;
    const extra: Extra = { ...empty, runtimes: {} };
    const replies = await Promise.all(
      reads.map(async (operation) => {
        const request = { operation } satisfies OpenbotAdminRequest;
        if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
          return null;
        const reply = await admin({ environmentId, input: { hostId, request } });
        return reply._tag === "Success" ? { operation, value: reply.value } : null;
      }),
    );
    if (cancelled() || readPreparedConnection(environmentId) !== prepared) return;
    for (const reply of replies) {
      if (!reply) continue;
      switch (reply.operation) {
        case "provider.accounts.list":
          extra.accounts = providerAccounts(reply.value);
          break;
        case "provider.accounts.usage":
          extra.usage = readAccountUsage(reply.value);
          break;
        case "provider.runtimes.status":
          for (const runtime of providerRuntimes(reply.value)?.providers ?? []) {
            if (
              isAgentProvider(runtime.id) &&
              ["not-downloaded", "downloading", "finishing", "ready", "download-error"].includes(
                runtime.phase,
              )
            )
              extra.runtimes[runtime.id] = {
                ...runtime,
                phase: runtime.phase as ProviderRuntimeStatus["phase"],
              };
          }
          break;
        case "provider.custom.list": {
          const parsed = decodeEndpoints(reply.value);
          if (Result.isSuccess(parsed)) extra.customProviders = [...parsed.success];
          break;
        }
        case "provider.customAgent.list": {
          const parsed = decodeAgents(reply.value);
          if (Result.isSuccess(parsed)) extra.customAgents = [...parsed.success];
          break;
        }
      }
    }
    setLoaded({ environmentId, hostId, connection: prepared, extra, access });
  });
  /* oxlint-disable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies -- Read-only admin snapshots are reloaded after a host, connection, permission or explicit refresh change; late replies are fenced. */
  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, hostId, connection, access, revision]);
  /* oxlint-enable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies */
  const extra =
    loaded?.environmentId === environmentId &&
    loaded.access === access &&
    loaded.hostId === hostId &&
    loaded.connection === readPreparedConnection(environmentId)
      ? loaded.extra
      : empty;
  const own = readAccountUsage(usageQuery.data);
  const usage = own
    ? {
        limits: [
          ...own.limits.filter((limit) => limit.accountId === undefined),
          ...(extra.usage?.limits ?? []).filter((limit) => limit.accountId !== undefined),
        ],
      }
    : extra.usage;
  const rawStatus = readAgentStatus(statusQuery.data);
  const status = rawStatus
    ? {
        ...rawStatus,
        providers: rawStatus.providers?.map((provider) => {
          const accounts = extra.accounts?.providers.find(
            (row) => row.provider === provider.id,
          )?.accounts;
          return accounts ? { ...provider, accounts: [...accounts] } : provider;
        }),
      }
    : null;
  const listings = decodeListings(listingQuery.data);
  const listingMap = new Map(
    Result.isSuccess(listings)
      ? listings.success.models.map((row) => [`${row.provider}\0${row.id}`, row.listing])
      : [],
  );
  const modelOptions = readModelOptions(modelsQuery.data).map((model) => {
    const listing = listingMap.get(`${model.provider}\0${model.id}`);
    return listing ? { ...model, listing } : model;
  });
  return {
    usage,
    status,
    modelOptions,
    runtimeStatuses: extra.runtimes,
    customProviders: extra.customProviders,
    customAgents: extra.customAgents,
    accounts: extra.accounts,
    loading: usageQuery.isPending || statusQuery.isPending,
    error: usageQuery.error ?? statusQuery.error,
    refresh: () => {
      usageQuery.refresh();
      statusQuery.refresh();
      modelsQuery.refresh();
      listingQuery.refresh();
      setRevision((value) => value + 1);
    },
  };
}
