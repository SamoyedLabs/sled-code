import { sha256 } from "@noble/hashes/sha2";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { agentProviderName, isAgentProvider } from "./upstream/provider/identity";
import { providerOffersModels } from "./upstream/provider/provider-model-options";
import type {
  AgentStatus,
  ClientAgentModelOption,
  ProviderRuntimeStatus,
  AgentProviderId,
} from "./upstream/provider/types";

/** UI-only provider entries. They never route a Threads request to a bot host. */
export function botModelPickerCatalog(input: {
  scope: string;
  accountChoice?: boolean | undefined;
  status: AgentStatus;
  models: readonly ClientAgentModelOption[];
  runtimes?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
}) {
  const destinations = new Map<
    ProviderInstanceId,
    { provider: AgentProviderId; accountId: string | null }
  >();
  const snapshots: ServerProvider[] = [];
  const ids = new Set([
    ...input.models.map((model) => model.provider),
    ...(input.status.providers?.map((row) => row.id) ?? []),
  ]);
  for (const provider of ids) {
    if (!isAgentProvider(provider)) continue;
    const status = input.status.providers?.find((row) => row.id === provider);
    const offered = providerOffersModels(
      input.status,
      input.models,
      provider,
      input.runtimes?.[provider],
    );
    const accounts = input.accountChoice && status?.accounts?.length ? status.accounts : [null];
    for (const account of accounts) {
      const instanceId = ProviderInstanceId.make(
        `bot_${Array.from(
          sha256(
            new TextEncoder().encode(JSON.stringify([input.scope, provider, account?.id ?? null])),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        )
          .join("")
          .slice(0, 56)}`,
      );
      const ready = offered && (!account || ["connected", "available"].includes(account.state));
      destinations.set(instanceId, {
        provider,
        accountId: account?.id === "default" ? null : (account?.id ?? null),
      });
      snapshots.push({
        instanceId,
        driver: ProviderDriverKind.make(provider),
        displayName: [
          status?.displayName || agentProviderName(provider),
          account?.label || account?.email,
        ]
          .filter(Boolean)
          .join(" · "),
        enabled: !status?.off,
        installed: !["not-downloaded", "download-error"].includes(
          input.runtimes?.[provider]?.phase ?? "ready",
        ),
        version: status?.version ?? null,
        status: ready ? "ready" : status?.off ? "disabled" : "error",
        auth: { status: ready ? "authenticated" : "unknown" },
        checkedAt: "1970-01-01T00:00:00.000Z",
        ...(account?.message || status?.message
          ? { message: account?.message || status?.message || "" }
          : {}),
        models: input.models
          .filter((model) => model.provider === provider)
          .map((model) => ({
            slug: model.id,
            name: model.name,
            isCustom: false,
            ...(model.listing === "older" ? { isLegacy: true } : {}),
            ...(model.listing === "new" ? { badge: "new" as const } : {}),
            capabilities: {
              optionDescriptors:
                model.reasoningEffortConfigurable === false ||
                !model.supportedReasoningEfforts.length
                  ? []
                  : [
                      {
                        id: "reasoningEffort",
                        label: "Reasoning effort",
                        type: "select" as const,
                        role: "reasoning" as const,
                        options: model.supportedReasoningEfforts.map((id) => ({
                          id,
                          label: id.charAt(0).toUpperCase() + id.slice(1),
                          isDefault: id === model.defaultReasoningEffort,
                        })),
                        currentValue: model.defaultReasoningEffort,
                      },
                    ],
            },
          })),
        slashCommands: [],
        skills: [],
      });
    }
  }
  const entries = deriveProviderInstanceEntries(snapshots).map((entry, index) => ({
    ...entry,
    displayName: snapshots[index]!.displayName ?? entry.displayName,
  }));
  return {
    entries,
    destinations,
    options: new Map(entries.map((entry) => [entry.instanceId, entry.models])),
  };
}
