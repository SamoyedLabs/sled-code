/* oxlint-disable t3code/no-low-value-comments -- Preserve provenance and constraints of the pinned upstream provider and quota rules. */
// Identity and quota rules translated from OpenBot 0.60.0 agent-providers.ts.
import type { AccountUsageLimit } from "./types";
export const descriptors = {
  codex: {
    id: "codex",
    displayName: "ChatGPT",
    cliName: "Codex CLI",
    defaultModel: "gpt-6-luna",
    pickerOrder: 1,
    reportsUsage: true,
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    cliName: "Claude Code",
    defaultModel: "claude-haiku-5-5",
    pickerOrder: 0,
    reportsUsage: true,
  },
  grok: {
    id: "grok",
    displayName: "Grok",
    cliName: "Grok CLI",
    defaultModel: "grok-4.6",
    pickerOrder: 2,
    reportsUsage: true,
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    cliName: "OpenCode CLI",
    defaultModel: "",
    pickerOrder: 3,
    reportsUsage: true,
  },
  antigravity: {
    id: "antigravity",
    displayName: "Gemini",
    cliName: "Antigravity ACP server",
    defaultModel: "",
    pickerOrder: 4,
    reportsUsage: true,
  },
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    cliName: "Cursor CLI",
    defaultModel: "",
    pickerOrder: 5,
    reportsUsage: true,
  },
  cline: {
    id: "cline",
    displayName: "Cline",
    cliName: "Cline CLI",
    defaultModel: "",
    pickerOrder: 6,
    reportsUsage: false,
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi",
    cliName: "Kimi Code CLI",
    defaultModel: "",
    pickerOrder: 7,
    reportsUsage: true,
  },
  pi: {
    id: "pi",
    displayName: "Pi",
    cliName: "Pi CLI",
    defaultModel: "",
    pickerOrder: 8,
    reportsUsage: false,
  },
  muse: {
    id: "muse",
    displayName: "Muse",
    cliName: "Muse CLI",
    defaultModel: "",
    pickerOrder: 9,
    reportsUsage: true,
  },
  inception: {
    id: "inception",
    displayName: "Inception",
    cliName: "Pi CLI",
    defaultModel: "mercury-3",
    pickerOrder: 10,
    reportsUsage: false,
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    cliName: "Pi CLI",
    defaultModel: "deepseek-v4-pro",
    pickerOrder: 11,
    reportsUsage: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    cliName: "Pi CLI",
    defaultModel: "anthropic/claude-sonnet-5.5",
    pickerOrder: 12,
    reportsUsage: false,
  },
  hermes: {
    id: "hermes",
    displayName: "Hermes",
    cliName: "Hermes Agent",
    defaultModel: "",
    pickerOrder: 13,
    reportsUsage: false,
  },
  acp: {
    id: "acp",
    displayName: "Custom agent",
    cliName: "ACP agent",
    defaultModel: "",
    pickerOrder: 7,
    reportsUsage: false,
  },
} as const;
export type AgentProviderId = keyof typeof descriptors;
export type AgentProviderRef = string;
export function isAgentProvider(value: unknown): value is AgentProviderId {
  return typeof value === "string" && Object.hasOwn(descriptors, value);
}
export const isKnownAgentProvider = isAgentProvider;
export function agentProviderDescriptor(provider: AgentProviderId) {
  return descriptors[provider];
}
export function agentProviderName(provider: AgentProviderId) {
  return descriptors[provider].displayName;
}
export function agentProviderCliName(provider: AgentProviderId) {
  return descriptors[provider].cliName;
}
export function defaultProviderModel(provider: AgentProviderId) {
  return descriptors[provider].defaultModel;
}
export const PICKER_PROVIDERS = (Object.keys(descriptors) as AgentProviderId[])
  .filter((id) => id !== "acp")
  .sort((a, b) => descriptors[a].pickerOrder - descriptors[b].pickerOrder);
export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";
export const CUSTOM_AGENT_DEFAULT_MODEL = "default";
export const DEFAULT_CUSTOM_PROVIDER_HARNESS = "opencode";
export function customAgentIdOfModel(model: string) {
  return model.includes("/") ? model.slice(0, model.indexOf("/")) : null;
}
export function isCustomProviderHarness(provider: string) {
  return provider === "opencode" || provider === "pi";
}
export function isFreeOpencodeModelName(name: string): boolean {
  return /\bfree$/i.test(name.trim());
}

/**
 * Free OpenCode models whose ids carry no Free marker.
 *
 * Keyless `opencode models` lists exactly these plus the `*-free` family -- re-run it with a clean
 * home directory if the free tier changes shape. Explicit on purpose: a stale entry hides a free
 * model, while guessing billed models as free bills the user. Every free decision -- the picker
 * badge, the catalog order, the stored-key drop -- goes through `isFreeOpencodeModel`, so the
 * three cannot disagree about what costs money.
 */
const FREE_TIER_MODEL_IDS = new Set(["opencode/big-pickle"]);

export function isFreeOpencodeModel(id: string, name: string): boolean {
  return FREE_TIER_MODEL_IDS.has(id.trim().toLowerCase()) || isFreeOpencodeModelName(name);
}

/**
 * Whether the provider's account quota limits this model. OpenCode reports only the Go quota, and
 * OpenCode also runs free, custom and own-sign-in models that the Go quota does not limit.
 * Antigravity's own reading is a Gemini quota group; its Claude and GPT models share another group,
 * which only the named groups (`usageGroupForModel`) show. Gemini model ids can be code names, so only
 * a Claude or GPT id is left out.
 */
export function accountUsageCoversModel(
  provider: AgentProviderId,
  model: string | null | undefined,
): boolean {
  if (provider === "opencode") return Boolean(model?.toLowerCase().startsWith("opencode-go/"));
  if (provider === "antigravity") return !/^(?:claude|gpt)/iu.test(model ?? "");
  return true;
}

/**
 * The windows that limit the model: the quota group that lists it when the reading lists the models
 * of its groups, or else the reading itself. Undefined when no group lists the model.
 */
export function usageQuotaForModel(
  limit: AccountUsageLimit,
  model: string | null | undefined,
): Pick<AccountUsageLimit, "primary" | "secondary"> | undefined {
  return model && limit.groups?.some((group) => group.models.length > 0)
    ? usageGroupForModel(limit.groups, model)
    : limit;
}

/**
 * The quota group that lists the model. Antigravity lists families ("Gemini Flash", "Gemini 4 Argon")
 * and the model ID adds a version and an effort (`gemini-3.8-flash-high`), so each word of a listed
 * name must be a word of the ID. The longest such name wins: "Gemini Flash Lite" before "Gemini Flash".
 */
export function usageGroupForModel<Group extends { models: readonly string[] }>(
  groups: readonly Group[],
  model: string,
): Group | undefined {
  const id = new Set(modelWords(model));
  let best: { group: Group; length: number } | undefined;
  for (const group of groups)
    for (const listed of group.models) {
      const words = modelWords(listed);
      if (words.length > (best?.length ?? 0) && words.every((word) => id.has(word)))
        best = { group, length: words.length };
    }
  return best?.group;
}

function modelWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/u)
    .filter(Boolean);
}
