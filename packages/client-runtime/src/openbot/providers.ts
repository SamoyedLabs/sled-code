import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { OpenbotAdminRequest } from "@t3tools/contracts";

const Text = Schema.String;
const Model = Schema.Struct({
  provider: Text,
  id: Text,
  name: Text,
  description: Text,
  defaultReasoningEffort: Text,
  supportedReasoningEfforts: Schema.Array(Text),
});
const Provider = Schema.Struct({
  id: Text,
  displayName: Schema.optional(Text),
  state: Text,
  message: Schema.NullOr(Text),
});
const Models = Schema.Array(Model);
const CustomEndpoint = Schema.Struct({
  id: Text,
  name: Text,
  baseUrl: Text,
  hasApiKey: Schema.Boolean,
  models: Schema.Array(Schema.Struct({ id: Text, name: Text })),
  harness: Schema.Literals(["opencode", "pi"]),
});
const CustomEndpoints = Schema.Array(CustomEndpoint);
const decodeCustomEndpoints = Schema.decodeUnknownResult(
  Schema.Union([CustomEndpoints, Schema.Struct({ providers: CustomEndpoints })]),
);
export function customProviderEndpoints(value: unknown) {
  const result = decodeCustomEndpoints(value);
  return Result.isSuccess(result)
    ? "providers" in result.success
      ? result.success.providers
      : result.success
    : null;
}
const CustomAcpAgent = Schema.Struct({
  id: Text,
  name: Text,
  command: Text,
  args: Schema.Array(Text),
  envNames: Schema.Array(Text),
  usagePrompt: Schema.NullOr(Text),
  resolvedCommand: Schema.NullOr(Text),
});
const CustomAgents = Schema.Array(CustomAcpAgent);
const decodeCustomAgents = Schema.decodeUnknownResult(
  Schema.Union([CustomAgents, Schema.Struct({ agents: CustomAgents })]),
);
export function customAcpAgents(value: unknown) {
  const result = decodeCustomAgents(value);
  return Result.isSuccess(result)
    ? "agents" in result.success
      ? result.success.agents
      : result.success
    : null;
}
const ModelVisibility = Schema.Struct({
  provider: Text,
  models: Schema.Array(Schema.Struct({ id: Text, name: Text })),
  shown: Schema.Array(Text),
  changed: Schema.Boolean,
});
const decodeModelVisibility = Schema.decodeUnknownResult(ModelVisibility);
export function botModelVisibility(value: unknown, provider: string) {
  const result = decodeModelVisibility(value);
  return Result.isSuccess(result) && result.success.provider === provider ? result.success : null;
}
export type BotCustomSecret = { key: number; name: string; value: string | null };
export type BotCustomEndpointDraft = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  headers: BotCustomSecret[];
};
export type BotCustomAcpDraft = {
  id: string;
  name: string;
  command: string;
  args: string;
  originalArgs?: readonly string[] | undefined;
  usagePrompt: string;
  env: BotCustomSecret[];
};
export function customEndpointRequest(draft: BotCustomEndpointDraft) {
  try {
    const url = new URL(draft.baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    return null;
  }
  const models = draft.models
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const divider = line.indexOf("|");
      const id = (divider < 0 ? line : line.slice(0, divider)).trim();
      return { id, name: divider < 0 ? id : line.slice(divider + 1).trim() };
    });
  if (models.length === 0 || new Set(models.map((model) => model.id)).size !== models.length)
    return null;
  if (draft.headers.some((header) => header.value === null)) return null;
  return providerAdminRequest({
    operation: "provider.custom.save",
    input: {
      id: draft.id.trim(),
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim() || null,
      models,
      headers: draft.headers.map(({ name, value }) => ({ name: name.trim(), value })),
    },
  });
}
export function customAcpRequest(draft: BotCustomAcpDraft) {
  if (!draft.command.trim() || /[\r\n\0]/.test(draft.command)) return null;
  const args =
    draft.originalArgs && draft.args === draft.originalArgs.join("\n")
      ? [...draft.originalArgs]
      : draft.args === ""
        ? []
        : draft.args.split(/\r?\n/);
  return providerAdminRequest({
    operation: "provider.customAgent.save",
    input: {
      id: draft.id.trim(),
      name: draft.name.trim(),
      command: draft.command.trim(),
      args,
      usagePrompt: draft.usagePrompt.trim() || null,
      env: draft.env.map(({ name, value }) => ({ name: name.trim(), value })),
    },
  });
}
const decodeRestart = Schema.decodeUnknownResult(
  Schema.Struct({ restart: Schema.Literals(["restarted", "skipped-busy", "not-running"]) }),
);
export function customRuntimeNotice(value: unknown) {
  const result = decodeRestart(value);
  return Result.isSuccess(result) && result.success.restart === "skipped-busy"
    ? "Saved. Busy bots will use the change after their current work finishes."
    : "Saved. Refresh providers to see the current models.";
}
export function botProviderSetupMessage(provider: BotProvider) {
  return provider.state === "not-installed"
    ? "Install this provider in Provider setup to continue."
    : (provider.message?.replaceAll("in OpenBot", "in Provider setup") ?? null);
}
const Status = Schema.Struct({ providers: Schema.Array(Provider) });
const Account = Schema.Struct({
  id: Text,
  label: Schema.NullOr(Text),
  email: Schema.NullOr(Text),
  state: Text,
  message: Schema.NullOr(Text),
});
const Accounts = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ provider: Text, accounts: Schema.Array(Account) })),
  agents: Schema.Array(Schema.Struct({ agentId: Text, accountId: Text })),
});
const Agents = Schema.Array(
  Schema.Struct({
    id: Text,
    provider: Text,
    model: Text,
    reasoningEffort: Schema.optional(Text),
    pendingRuntime: Schema.optional(
      Schema.NullOr(Schema.Struct({ provider: Text, model: Text, reasoningEffort: Text })),
    ),
  }),
);
const Runtime = Schema.Struct({
  id: Text,
  phase: Text,
  progress: Schema.NullOr(Schema.Number),
  message: Schema.NullOr(Text),
  version: Schema.NullOr(Text),
});
const Runtimes = Schema.Struct({ providers: Schema.Array(Runtime) });
const KeyState = Schema.Struct({ status: Schema.Literals(["missing", "saved", "unreadable"]) });
const HostSignIn = Schema.Struct({
  tabId: Schema.NullOr(Text),
  result: Schema.NullOr(Schema.Struct({ error: Schema.NullOr(Text) })),
});
const CodeSignIn = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("connected") }),
  Schema.Struct({
    kind: Schema.Literal("code"),
    userCode: Text,
    verificationUrl: Text,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literals(["paste", "link"]),
    verificationUrl: Text,
    expiresAt: Schema.Number,
  }),
]);
const decodeModels = Schema.decodeUnknownResult(Models);
const decodeStatus = Schema.decodeUnknownResult(Status);
const decodeAccounts = Schema.decodeUnknownResult(Accounts);
const decodeAgents = Schema.decodeUnknownResult(Agents);
const decodeRuntimes = Schema.decodeUnknownResult(Runtimes);
const decodeKey = Schema.decodeUnknownResult(KeyState);
const decodeHostSignIn = Schema.decodeUnknownResult(HostSignIn);
const decodeCodeSignIn = Schema.decodeUnknownResult(CodeSignIn);
const decodeAdmin = Schema.decodeUnknownResult(OpenbotAdminRequest);
export function providerAdminRequest(value: unknown) {
  const decoded = decodeAdmin(value);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
const RelayStarted = Schema.Struct({ flowId: Text, expiresAt: Schema.Int });
const RelayStatus = Schema.Struct({
  authorizeUrl: Schema.NullOr(Text),
  callback: Schema.NullOr(
    Schema.Struct({ port: Schema.Int, path: Text, state: Schema.NullOr(Text) }),
  ),
  result: Schema.NullOr(Schema.Struct({ error: Schema.NullOr(Text) })),
});
const Defaults = Schema.Struct({ provider: Schema.NullOr(Text), model: Schema.NullOr(Text) });
const decodeRelayStarted = Schema.decodeUnknownResult(RelayStarted);
const decodeRelayStatus = Schema.decodeUnknownResult(RelayStatus);
const decodeDefaults = Schema.decodeUnknownResult(Defaults);

export type BotProviderModel = typeof Model.Type;
export type BotProvider = typeof Provider.Type;
export type BotProviderAccounts = typeof Accounts.Type;
export type BotProviderRuntimes = typeof Runtimes.Type;
export type BotProviderCodeSignIn = typeof CodeSignIn.Type;
export type BotProviderHostSignIn = typeof HostSignIn.Type;
export type BotProviderChoice = {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
};
export type BotProviderSetupState = {
  accounts: BotProviderAccounts | null;
  runtimes: BotProviderRuntimes | null;
  keyState: ReturnType<typeof providerKeyState>;
  codeSignIn: BotProviderCodeSignIn | null;
  hostSignIn: (BotProviderHostSignIn & { kind: "provider" | "account"; provider: string }) | null;
  relay: { flowId: string; expiresAt: number; status: typeof RelayStatus.Type | null } | null;
  defaults: typeof Defaults.Type | null;
  error: string | null;
};
export const EMPTY_PROVIDER_SETUP: BotProviderSetupState = {
  accounts: null,
  runtimes: null,
  keyState: null,
  codeSignIn: null,
  hostSignIn: null,
  relay: null,
  defaults: null,
  error: null,
};
export const EMPTY_BOT_PROVIDER_CHOICE: BotProviderChoice = {
  provider: "",
  model: "",
  reasoningEffort: null,
};

export function providerModels(value: unknown) {
  const decoded = decodeModels(value);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
export function providerStatus(value: unknown) {
  const decoded = decodeStatus(value);
  return Result.isSuccess(decoded) ? decoded.success.providers : null;
}
export function providerAccounts(value: unknown) {
  const decoded = decodeAccounts(value);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
export function providerAgent(value: unknown, agentId: string) {
  const decoded = decodeAgents(value);
  return Result.isSuccess(decoded)
    ? (decoded.success.find((agent) => agent.id === agentId) ?? null)
    : null;
}
function providerRuntimes(value: unknown) {
  const decoded = decodeRuntimes(value);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
function providerKeyState(value: unknown) {
  const decoded = decodeKey(value);
  return Result.isSuccess(decoded) ? decoded.success.status : null;
}
function providerHostSignIn(value: unknown) {
  const decoded = decodeHostSignIn(value);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
export function providerCodeSignIn(value: unknown) {
  const decoded = decodeCodeSignIn(value);
  if (!Result.isSuccess(decoded)) return null;
  const result = decoded.success;
  if (result.kind === "connected") return result;
  try {
    return new URL(result.verificationUrl).protocol === "https:" ? result : null;
  } catch {
    return null;
  }
}
export function providerOptions(
  models: readonly BotProviderModel[],
  providers: readonly BotProvider[],
) {
  const names = new Map(
    providers.map((provider) => [provider.id, provider.displayName ?? provider.id]),
  );
  for (const model of models)
    if (!names.has(model.provider)) names.set(model.provider, model.provider);
  return [...names].map(([id, name]) => ({ id, name }));
}
export function selectedProviderModel(
  models: readonly BotProviderModel[],
  choice: BotProviderChoice,
) {
  return (
    models.find((model) => model.provider === choice.provider && model.id === choice.model) ?? null
  );
}
export function validProviderChoice(
  models: readonly BotProviderModel[],
  providers: readonly BotProvider[],
  choice: BotProviderChoice,
) {
  const model = selectedProviderModel(models, choice);
  return (
    model !== null &&
    providers.some(
      (provider) => provider.id === choice.provider && provider.state === "available",
    ) &&
    (choice.reasoningEffort === null ||
      model.supportedReasoningEfforts.includes(choice.reasoningEffort))
  );
}
export function botCreateRequest(name: string, instructions: string, choice: BotProviderChoice) {
  const decoded = decodeAdmin({
    operation: "agent.create",
    input: {
      name: name.trim(),
      description: instructions.trim(),
      initialMessage: instructions.trim(),
      provider: choice.provider,
      model: choice.model,
      ...(choice.reasoningEffort === null ? {} : { reasoningEffort: choice.reasoningEffort }),
    },
  });
  return Result.isSuccess(decoded) && choice.provider !== "" && choice.model !== ""
    ? decoded.success
    : null;
}
export function botProviderUpdateRequest(
  agentId: string,
  choice: BotProviderChoice,
  models: readonly BotProviderModel[],
) {
  const selected = selectedProviderModel(models, choice);
  if (selected === null) return null;
  const decoded = decodeAdmin({
    operation: "agent.update",
    agentId,
    input: {
      provider: choice.provider,
      model: choice.model,
      reasoningEffort: choice.reasoningEffort ?? selected.defaultReasoningEffort,
    },
  });
  return Result.isSuccess(decoded) && choice.provider !== "" && choice.model !== ""
    ? decoded.success
    : null;
}

// Released v0.60 sign-in methods; provider/model choices still come from the live host catalog.
const CODE_SIGN_IN: ReadonlySet<string> = new Set([
  "codex",
  "claude",
  "grok",
  "cursor",
  "cline",
  "kimi",
  "muse",
  "hermes",
]);
export function providerSetupCapabilities(
  provider: string,
  runtimes: BotProviderRuntimes | null,
  accounts: BotProviderAccounts | null,
) {
  const managed = runtimes?.providers.some((runtime) => runtime.id === provider) ?? false;
  return {
    codeSignIn: CODE_SIGN_IN.has(provider),
    hostSignIn: provider === "antigravity",
    apiKey: managed || ["inception", "deepseek", "openrouter"].includes(provider),
    managed,
    multipleAccounts: accounts?.providers.some((row) => row.provider === provider) ?? false,
    signOut: ["codex", "claude", "grok", "muse", "cursor", "kimi"].includes(provider),
    relay: ["codex", "claude", "antigravity", "muse"].includes(provider),
    accountRelay: ["codex", "claude", "antigravity"].includes(provider),
  };
}

export function providerSetupResult(
  state: BotProviderSetupState,
  request: OpenbotAdminRequest,
  value: unknown,
): BotProviderSetupState {
  const next: BotProviderSetupState = { ...state, error: null };
  switch (request.operation) {
    case "provider.accounts.list":
      next.accounts = providerAccounts(value);
      if (!next.accounts) next.error = "This engine returned unsupported account settings.";
      break;
    case "provider.runtimes.status":
    case "provider.runtimes.check":
    case "provider.runtimes.download":
    case "provider.runtimes.cancel":
      next.runtimes = providerRuntimes(value);
      if (!next.runtimes) next.error = "This engine returned unsupported runtime settings.";
      break;
    case "provider.apiKey.state":
      next.keyState = providerKeyState(value);
      if (!next.keyState) next.error = "This engine returned unsupported key status.";
      break;
    case "provider.codeLogin.start":
      next.codeSignIn = providerCodeSignIn(value);
      if (!next.codeSignIn) next.error = "This engine returned an unsupported sign-in page.";
      break;
    case "provider.codeLogin.cancel":
      next.codeSignIn = null;
      break;
    case "provider.hostSignIn.start":
    case "provider.account.signIn.start":
      next.hostSignIn = {
        kind: request.operation === "provider.hostSignIn.start" ? "provider" : "account",
        provider: request.provider,
        tabId: null,
        result: null,
      };
      break;
    case "provider.hostSignIn.status":
    case "provider.account.signIn.status": {
      const status = providerHostSignIn(value);
      if (!status) next.error = "This engine returned unsupported sign-in status.";
      else
        next.hostSignIn = {
          ...status,
          kind: request.operation === "provider.hostSignIn.status" ? "provider" : "account",
          provider: request.provider,
        };
      break;
    }
    case "provider.hostSignIn.cancel":
    case "provider.account.signIn.cancel":
      next.hostSignIn = null;
      break;
    case "provider.signInRelay.start":
    case "provider.account.signInRelay.start": {
      const decoded = decodeRelayStarted(value);
      if (Result.isSuccess(decoded)) next.relay = { ...decoded.success, status: null };
      else next.error = "This engine returned unsupported sign-in status.";
      break;
    }
    case "provider.signInRelay.status":
    case "provider.signInRelay.complete": {
      const decoded = decodeRelayStatus(value);
      if (next.relay?.flowId !== request.flowId) break;
      if (!Result.isSuccess(decoded))
        next.error = "This engine returned unsupported sign-in status.";
      else {
        const status = decoded.success;
        if (status.authorizeUrl !== null && !webSignInUrl(status.authorizeUrl))
          next.error = "This engine returned an unsupported sign-in page.";
        else next.relay = { ...next.relay, status };
      }
      break;
    }
    case "provider.signInRelay.cancel":
      next.relay = null;
      break;
    case "provider.default.read":
    case "provider.default.update": {
      const decoded = decodeDefaults(value);
      if (Result.isSuccess(decoded)) next.defaults = decoded.success;
      else next.error = "This engine returned unsupported default settings.";
      break;
    }
  }
  return next;
}
function webSignInUrl(value: string) {
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
export function providerRelayCallbackQuery(
  value: string,
  callback: NonNullable<typeof RelayStatus.Type.callback>,
) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      Number(url.port) !== callback.port ||
      url.pathname !== callback.path
    )
      return null;
    if (!url.searchParams.has("code") && !url.searchParams.has("error")) return null;
    if (
      callback.state !== null &&
      (url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== callback.state)
    )
      return null;
    return url.search.slice(1);
  } catch {
    return null;
  }
}
