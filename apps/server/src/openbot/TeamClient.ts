import * as UiBlocks from "./UiBlocks.ts";
import { OpenbotConversationSnapshot } from "@t3tools/contracts";
import * as CatalogProtocol from "./CatalogProtocol.ts";
import * as ComputerViewSession from "./ComputerViewSession.ts";
import * as DataProtocol from "./DataProtocol.ts";
import * as VaultProtocol from "./VaultProtocol.ts";
import * as ComputerProtocol from "./ComputerProtocol.ts";
import * as EventProtocol from "./EventProtocol.ts";
import * as RoutineFlowProtocol from "./RoutineFlowProtocol.ts";
import * as ConversationProtocol from "./ConversationProtocol.ts";
import * as QueueProtocol from "./QueueProtocol.ts";
import * as BrowserProtocol from "./BrowserProtocol.ts";
import {
  OpenbotReadRequest,
  OpenbotWriteRequest,
  OpenbotAdminRequest,
  OpenbotMcpConfig,
  type OpenbotApiResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as EventStream from "./EventStream.ts";
import * as FileProtocol from "./FileProtocol.ts";
import * as WorkflowProtocol from "./WorkflowProtocol.ts";
import * as ChannelProtocol from "./ChannelProtocol.ts";
import * as CoreWire from "./CoreWire.ts";

export class TeamClientError extends Schema.TaggedError<TeamClientError>()(
  "OpenbotTeamClientError",
  {
    reason: Schema.Literals(["invalid-configuration", "transport", "http", "decode", "closed"]),
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "The local Openbot connection could not complete the request.";
  }
}

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Agent = Schema.Struct({
  id: Identifier,
  name: Schema.String.check(Schema.isMaxLength(256)),
  provider: Identifier,
});
const Roster = Schema.Array(Agent).check(Schema.isMaxLength(10_000));
const Login = Schema.Struct({
  sessionToken: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  sessionExpiresAt: Schema.String.check(Schema.isMaxLength(64)),
});

const isTeamClientError = Schema.is(TeamClientError);
const isUiBlockRefused = Schema.is(UiBlocks.UiBlockRefused);
const decodeLogin = Schema.decodeUnknownEffect(Login);
const decodeRoster = Schema.decodeUnknownEffect(Roster);
const SafeMcpRow = Schema.Struct({
  id: Identifier,
  name: Schema.String,
  transport: Schema.Literals(["stdio", "http"]),
  enabled: Schema.Boolean,
  url: Schema.String,
});
const decodeMcpRows = Schema.decodeUnknownEffect(Schema.Array(SafeMcpRow));
const decodeStoredMcpRows = Schema.decodeUnknownEffect(Schema.Array(OpenbotMcpConfig));
const decodeMcpConfig = Schema.decodeUnknownEffect(OpenbotMcpConfig);
const ConnectorIdentifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const decodeMessagingOrchestrator = Schema.decodeUnknownEffect(
  Schema.Struct({ agentId: ConnectorIdentifier, sectionId: Schema.NullOr(ConnectorIdentifier) }),
);
const McpResult = Schema.Struct({ toolCount: Schema.Int, error: Schema.NullOr(Schema.String) });
const decodeMcpResult = Schema.decodeUnknownEffect(McpResult);
const decodeMcpStatus = Schema.decodeUnknownEffect(
  Schema.Struct({ tabId: Schema.NullOr(Schema.String), result: Schema.NullOr(McpResult) }),
);
const safeMcpResult = (result: typeof McpResult.Type) => ({
  toolCount: result.toolCount,
  error: result.error === null ? null : "The host MCP connection failed.",
});
const safeMcpUrl = (value: string) => {
  try {
    return value === "" ? "" : new URL(value).origin;
  } catch {
    return "";
  }
};

const ProviderId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const AccountId = Schema.String.check(Schema.isPattern(/^(?:default|a[0-9a-f]{16})$/));
const PublicText = Schema.String.check(Schema.isMaxLength(2000));
const NullableText = Schema.NullOr(PublicText);
const PublicUrl = Schema.String.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//));
const ProviderAccount = Schema.Struct({
  id: AccountId,
  label: NullableText,
  email: NullableText,
  state: PublicText,
  message: NullableText,
});
const ProviderAccounts = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: ProviderId,
      accounts: Schema.Array(ProviderAccount).check(Schema.isMaxLength(10)),
    }),
  ).check(Schema.isMaxLength(64)),
  agents: Schema.Array(Schema.Struct({ agentId: Identifier, accountId: AccountId })).check(
    Schema.isMaxLength(10000),
  ),
});
const UsageWindow = Schema.Struct({
  usedPercent: Schema.Number,
  windowDurationMins: Schema.NullOr(Schema.Int),
  resetsAt: Schema.NullOr(Schema.Number),
});
const ProviderUsage = Schema.Struct({
  limits: Schema.Array(
    Schema.Struct({
      id: ProviderId,
      accountId: AccountId,
      primary: Schema.NullOr(UsageWindow),
      secondary: Schema.NullOr(UsageWindow),
    }),
  ).check(Schema.isMaxLength(640)),
});
const ProviderSignInStatus = Schema.Struct({
  tabId: Schema.NullOr(Identifier),
  result: Schema.NullOr(Schema.Struct({ error: NullableText })),
});
const ProviderLogin = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("code"),
    userCode: Schema.String.check(Schema.isMaxLength(64)),
    verificationUrl: PublicUrl,
    verificationUrlComplete: Schema.optional(PublicUrl),
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literals(["paste", "link"]),
    verificationUrl: PublicUrl,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("connected") }),
]);
const Runtime = Schema.Struct({
  id: ProviderId,
  phase: Schema.Literals(["not-downloaded", "downloading", "finishing", "ready", "download-error"]),
  progress: Schema.NullOr(Schema.Int),
  message: NullableText,
  version: NullableText,
  availableVersion: Schema.optional(NullableText),
});
const ProviderRuntimes = Schema.Struct({
  revision: Schema.Int,
  providers: Schema.Array(Runtime).check(Schema.isMaxLength(64)),
  toolRuntimes: Schema.Array(Runtime).check(Schema.isMaxLength(64)),
});
const CustomProvider = Schema.Struct({
  id: Identifier,
  name: PublicText,
  baseUrl: PublicUrl,
  hasApiKey: Schema.Boolean,
  models: Schema.Array(Schema.Struct({ id: PublicText, name: PublicText })).check(
    Schema.isMaxLength(64),
  ),
  harness: Schema.Literals(["opencode", "pi"]),
});
const CustomAgent = Schema.Struct({
  id: Identifier,
  name: PublicText,
  command: PublicText,
  args: Schema.Array(PublicText).check(Schema.isMaxLength(32)),
  envNames: Schema.Array(PublicText).check(Schema.isMaxLength(16)),
  usagePrompt: NullableText,
  resolvedCommand: NullableText,
});
const Restart = Schema.Literals(["restarted", "skipped-busy", "not-running"]);
const ModelVisibility = Schema.Struct({
  provider: ProviderId,
  models: Schema.Array(Schema.Struct({ id: PublicText, name: PublicText })).check(
    Schema.isMaxLength(10000),
  ),
  shown: Schema.Array(PublicText).check(Schema.isMaxLength(10000)),
  changed: Schema.Boolean,
});
const providerDecoders = {
  relayStarted: Schema.decodeUnknownEffect(
    Schema.Struct({ flowId: Identifier, expiresAt: Schema.Int }),
  ),
  relayFlow: Schema.decodeUnknownEffect(
    Schema.Struct({
      authorizeUrl: Schema.NullOr(
        Schema.String.check(Schema.isMaxLength(8192), Schema.isPattern(/^https?:\/\//)),
      ),
      callback: Schema.NullOr(
        Schema.Struct({
          port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
          path: Schema.String.check(Schema.isMaxLength(2048)),
          state: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
        }),
      ),
      result: Schema.NullOr(
        Schema.Struct({ error: NullableText, toolCount: Schema.optional(Schema.Int) }),
      ),
    }),
  ),
  empty: Schema.decodeUnknownEffect(Schema.Struct({})),
  accounts: Schema.decodeUnknownEffect(ProviderAccounts),
  usage: Schema.decodeUnknownEffect(ProviderUsage),
  login: Schema.decodeUnknownEffect(ProviderLogin),
  signInStatus: Schema.decodeUnknownEffect(ProviderSignInStatus),
  keyState: Schema.decodeUnknownEffect(
    Schema.Struct({ status: Schema.Literals(["missing", "saved", "unreadable"]) }),
  ),
  runtimes: Schema.decodeUnknownEffect(ProviderRuntimes),
  customProviders: Schema.decodeUnknownEffect(
    Schema.Array(CustomProvider).check(Schema.isMaxLength(256)),
  ),
  customProviderResult: Schema.decodeUnknownEffect(
    Schema.Struct({
      providers: Schema.Array(CustomProvider).check(Schema.isMaxLength(256)),
      restart: Restart,
    }),
  ),
  customAgents: Schema.decodeUnknownEffect(Schema.Array(CustomAgent).check(Schema.isMaxLength(16))),
  customAgentResult: Schema.decodeUnknownEffect(
    Schema.Struct({
      agents: Schema.Array(CustomAgent).check(Schema.isMaxLength(16)),
      restart: Restart,
    }),
  ),
  default: Schema.decodeUnknownEffect(
    Schema.Struct({ provider: Schema.NullOr(ProviderId), model: NullableText }),
  ),
  modelVisibility: Schema.decodeUnknownEffect(ModelVisibility),
  modelListings: Schema.decodeUnknownEffect(
    Schema.Struct({
      models: Schema.Array(
        Schema.Struct({
          provider: ProviderId,
          id: PublicText,
          listing: Schema.Literals(["new", "older"]),
        }),
      ).check(Schema.isMaxLength(10000)),
    }),
  ),
};

const decodeJsonValue = Schema.decodeUnknownEffect(Schema.Json);
const decodeProviderResult = Effect.fn("OpenbotTeamClient.projectProvider")((
  projection: keyof typeof providerDecoders,
  value: unknown,
) => {
  const decode: (value: unknown) => Effect.Effect<unknown, Schema.SchemaError> =
    providerDecoders[projection];
  return decode(value).pipe(Effect.flatMap(decodeJsonValue));
});
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));
const decodeReadRequest = Schema.decodeUnknownEffect(OpenbotReadRequest);
const decodeWriteRequest = Schema.decodeUnknownEffect(OpenbotWriteRequest);
const decodeAdminRequest = Schema.decodeUnknownEffect(OpenbotAdminRequest);

type ApiRequest = OpenbotReadRequest | OpenbotWriteRequest | OpenbotAdminRequest;
type SavedMcpRequest = Extract<
  ApiRequest,
  {
    operation:
      | "mcp.updateById"
      | "mcp.testById"
      | "mcp.signIn.startById"
      | "mcp.signIn.statusById"
      | "mcp.signIn.cancelById";
  }
>;
function isSavedMcpRequest(request: ApiRequest): request is SavedMcpRequest {
  return (
    request.operation === "mcp.updateById" ||
    request.operation === "mcp.testById" ||
    request.operation === "mcp.signIn.startById" ||
    request.operation === "mcp.signIn.statusById" ||
    request.operation === "mcp.signIn.cancelById"
  );
}
interface Route {
  readonly catalogProjection?: Parameters<typeof CatalogProtocol.project>[0];
  readonly dataProjection?: Parameters<typeof DataProtocol.project>[0];
  readonly vaultProjection?: Parameters<typeof VaultProtocol.project>[0];
  readonly vaultVersion?: "v1" | "v2";
  readonly method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  readonly path: string;
  readonly body?: unknown;
  readonly projection?: "mcp-list" | "mcp-test" | "mcp-status" | "messaging-orchestrator";
  readonly providerProjection?: keyof typeof providerDecoders;
  readonly eventProjection?: Parameters<typeof EventProtocol.project>[0];
  readonly routineFlowProjection?: Parameters<typeof RoutineFlowProtocol.project>[0];
  readonly workflowProjection?: Parameters<typeof WorkflowProtocol.project>[0];
  readonly conversationProjection?: Parameters<typeof ConversationProtocol.project>[0];
  readonly queueProjection?: string;
  readonly computerProjection?: Parameters<typeof ComputerProtocol.project>[0];
  readonly channelProjection?: Parameters<typeof ChannelProtocol.project>[0];
}
// Only these source-backed operations can spend the private host-owner session.
function apiRoute(request: Exclude<ApiRequest, SavedMcpRequest>): Route {
  if (CatalogProtocol.isRequest(request)) return CatalogProtocol.route(request);
  if (DataProtocol.isRequest(request)) return DataProtocol.route(request);
  if (VaultProtocol.isRequest(request)) return VaultProtocol.route(request);
  if (EventProtocol.isRequest(request)) return EventProtocol.route(request);
  if (RoutineFlowProtocol.isRequest(request)) return RoutineFlowProtocol.route(request);
  if (ConversationProtocol.isRequest(request)) return ConversationProtocol.route(request);
  if (QueueProtocol.isRequest(request)) return QueueProtocol.route(request);
  if (WorkflowProtocol.isRequest(request)) return WorkflowProtocol.route(request);
  if (ComputerProtocol.isRequest(request)) return ComputerProtocol.route(request);
  if (ChannelProtocol.isRequest(request)) return ChannelProtocol.route(request);
  const agentPath =
    "agentId" in request ? `/v1/agents/${encodeURIComponent(request.agentId)}` : "/v1/agents";
  switch (request.operation) {
    case "provider.signInRelay.start":
      return {
        method: "POST",
        path: "/v1/admin/sign-in-relay/provider/start",
        body: { provider: request.provider },
        providerProjection: "relayStarted",
      };
    case "provider.account.signInRelay.start":
      return {
        method: "POST",
        path: "/v1/admin/sign-in-relay/provider-account/v2/start",
        body: { provider: request.provider, accountId: request.accountId },
        providerProjection: "relayStarted",
      };
    case "provider.signInRelay.status":
    case "provider.signInRelay.cancel":
      return {
        method: "POST",
        path: `/v1/admin/sign-in-relay/${request.operation.endsWith("status") ? "status" : "cancel"}`,
        body: { flowId: request.flowId },
        providerProjection: request.operation.endsWith("status") ? "relayFlow" : "empty",
      };
    case "provider.signInRelay.complete":
      return {
        method: "POST",
        path: "/v1/admin/sign-in-relay/complete",
        body: { flowId: request.flowId, query: request.query },
        providerProjection: "relayFlow",
      };
    case "provider.accounts.list":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/list",
        body: {},
        providerProjection: "accounts",
      };
    case "provider.accounts.usage":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/usage",
        body: {},
        providerProjection: "usage",
      };
    case "provider.account.assign":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/agent",
        body: { agentId: request.agentId, accountId: request.accountId },
        providerProjection: "empty",
      };
    case "provider.account.signIn.start":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/sign-in/start",
        body: { provider: request.provider, accountId: request.accountId },
        providerProjection: "empty",
      };
    case "provider.account.signIn.status":
    case "provider.account.signIn.cancel":
      return {
        method: "POST",
        path: `/v1/admin/providers/accounts/sign-in/${request.operation.endsWith("status") ? "status" : "cancel"}`,
        body: { provider: request.provider },
        providerProjection: request.operation.endsWith("status") ? "signInStatus" : "empty",
      };
    case "provider.account.rename":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/rename",
        body: { provider: request.provider, accountId: request.accountId, label: request.label },
        providerProjection: "empty",
      };
    case "provider.account.remove":
      return {
        method: "POST",
        path: "/v1/admin/providers/accounts/remove",
        body: { provider: request.provider, accountId: request.accountId },
        providerProjection: "empty",
      };
    case "provider.codeLogin.start":
    case "provider.codeLogin.cancel":
      return {
        method: "POST",
        path: `/v1/admin/providers/v8/code-login/${request.operation.endsWith("start") ? "start" : "cancel"}`,
        body: { provider: request.provider },
        providerProjection: request.operation.endsWith("start") ? "login" : "empty",
      };
    case "provider.codeLogin.submit":
      return {
        method: "POST",
        path: "/v1/admin/providers/v8/code-login/submit",
        body: { provider: request.provider, code: request.code },
        providerProjection: "empty",
      };
    case "provider.apiKey.state":
    case "provider.apiKey.clear":
      return {
        method: "POST",
        path: `/v1/admin/providers/v8/api-key/${request.operation.endsWith("state") ? "state" : "clear"}`,
        body: { provider: request.provider },
        providerProjection: request.operation.endsWith("state") ? "keyState" : "empty",
      };
    case "provider.apiKey.set":
      return {
        method: "POST",
        path: "/v1/admin/providers/v8/api-key/set",
        body: { provider: request.provider, key: request.key },
        providerProjection: "empty",
      };
    case "provider.runtimes.status":
    case "provider.runtimes.check":
      return {
        method: "POST",
        path: `/v1/admin/providers/v8/runtimes/${request.operation.endsWith("status") ? "status" : "check-updates"}`,
        body: {},
        providerProjection: "runtimes",
      };
    case "provider.runtimes.download":
    case "provider.runtimes.cancel":
      return {
        method: "POST",
        path: `/v1/admin/providers/v8/runtimes/${request.operation.endsWith("download") ? "download" : "cancel"}`,
        body: { provider: request.provider },
        providerProjection: "runtimes",
      };
    case "provider.hostSignIn.start":
    case "provider.hostSignIn.status":
    case "provider.hostSignIn.cancel":
      return {
        method: "POST",
        path: `/v1/admin/providers/host-sign-in/${request.operation.slice("provider.hostSignIn.".length)}`,
        body: { provider: request.provider },
        providerProjection: request.operation.endsWith("status") ? "signInStatus" : "empty",
      };
    case "provider.signOut":
      return {
        method: "POST",
        path: "/v1/admin/providers/sign-out",
        body: { provider: request.provider },
        providerProjection: "empty",
      };
    case "provider.default.read":
      return {
        method: "POST",
        path: "/v1/admin/host/default-provider",
        body: {},
        providerProjection: "default",
      };
    case "provider.default.update":
      return {
        method: "POST",
        path: "/v1/admin/host/default-provider/update",
        body: { provider: request.provider, model: request.model },
        providerProjection: "default",
      };
    case "provider.custom.list":
      return {
        method: "POST",
        path: "/v1/admin/providers/custom-harness/list",
        body: {},
        providerProjection: "customProviders",
      };
    case "provider.custom.save":
      return {
        method: "POST",
        path: "/v1/admin/providers/custom-harness/save",
        body: request.input,
        providerProjection: "customProviderResult",
      };
    case "provider.custom.delete":
      return {
        method: "POST",
        path: "/v1/admin/providers/custom-harness/delete",
        body: { id: request.id },
        providerProjection: "customProviderResult",
      };
    case "provider.customAgent.list":
      return {
        method: "POST",
        path: "/v1/admin/custom-agents/list",
        body: {},
        providerProjection: "customAgents",
      };
    case "provider.customAgent.save":
      return {
        method: "POST",
        path: "/v1/admin/custom-agents/save",
        body: request.input,
        providerProjection: "customAgentResult",
      };
    case "provider.customAgent.delete":
      return {
        method: "POST",
        path: "/v1/admin/custom-agents/delete",
        body: { id: request.id },
        providerProjection: "customAgentResult",
      };
    case "provider.modelVisibility.read":
      return {
        method: "POST",
        path: "/v1/admin/host/model-visibility",
        body: { provider: request.provider },
        providerProjection: "modelVisibility",
      };
    case "provider.modelVisibility.update":
      return {
        method: "POST",
        path: "/v1/admin/host/model-visibility/update",
        body: { provider: request.provider, shown: request.shown },
        providerProjection: "modelVisibility",
      };
    case "provider.modelVisibility.listing":
      return {
        method: "POST",
        path: "/v1/model-visibility/listing",
        body: {},
        providerProjection: "modelListings",
      };
    case "agent.models":
      return { method: "GET", path: "/v1/agents/models" };
    case "agent.status":
      return { method: "GET", path: "/v1/agents/status" };
    case "compatibility.read":
      return { method: "GET", path: "/v1/compatibility" };

    case "approval.respond":
      return {
        method: "POST",
        path: "/v1/approvals/respond",
        body: { requestId: request.requestId, decision: request.decision },
      };
    case "prompt.respond":
      return {
        method: "POST",
        path: "/v1/prompts/respond",
        body: { requestId: request.requestId, answers: request.answers },
      };
    case "takeover.respond":
      return {
        method: "POST",
        path: "/v1/browser-takeovers/respond",
        body: { requestId: request.requestId, decision: request.decision },
      };
    case "agent.permissions.read":
      return {
        method: "POST",
        path: "/v1/admin/agents/settings",
        body: { agentId: request.agentId },
      };
    case "agent.permissions.update": {
      const { operation: _operation, ...body } = request;
      return { method: "POST", path: "/v1/admin/agents/settings/update", body };
    }
    case "agent.instructions.read":
      return {
        method: "POST",
        path: "/v1/admin/agents/instructions",
        body: { agentId: request.agentId },
      };
    case "agent.instructions.save": {
      const { operation: _operation, ...body } = request;
      return { method: "POST", path: "/v1/admin/agents/instructions/save", body };
    }
    case "browser.display":
      return { method: "GET", path: "/v1/browser/display" };
    case "browser.tabProfiles":
      return { method: "POST", path: "/v1/browser/tab-profiles", body: {} };
    case "browser.profiles.list":
      return { method: "POST", path: "/v1/admin/browser-profiles", body: {} };
    case "browser.profiles.create":
    case "browser.profiles.update":
    case "browser.profiles.clear":
    case "browser.profiles.delete": {
      const { operation, ...body } = request;
      return { method: "POST", path: `/v1/admin/browser-profiles/${operation.slice(17)}`, body };
    }
    case "browser.profile.clearAgent":
      return {
        method: "POST",
        path: "/v1/admin/browser-profiles/clear",
        body: { agentId: request.agentId },
      };
    case "browser.profile.read":
      return {
        method: "POST",
        path: "/v1/admin/agents/browser-profile",
        body: { agentId: request.agentId },
      };
    case "browser.profile.assign":
      return {
        method: "POST",
        path: "/v1/admin/agents/browser-profile/update",
        body: { agentId: request.agentId, profile: request.profile },
      };
    case "browser.stop":
      return { method: "POST", path: "/v1/browser/stop", body: { tabId: request.tabId } };
    case "browser.tabs":
      return { method: "GET", path: "/v1/browser/tabs" };
    case "browser.control":
      return { method: "GET", path: "/v1/browser/control" };
    case "browser.held":
      return { method: "POST", path: "/v1/browser/user-control", body: {} };
    case "browser.open":
      return {
        method: "POST",
        path: "/v1/browser/open",
        body: { url: request.url, focus: request.focus, ownerThreadId: null, ownerAgentId: null },
      };
    case "browser.activate":
    case "browser.reload":
    case "browser.close":
    case "browser.preview":
      return {
        method: "POST",
        path: `/v1/browser/${request.operation.slice(8)}`,
        body: { tabId: request.tabId },
      };
    case "browser.take":
    case "browser.release":
      return {
        method: "POST",
        path: `/v1/browser/user-control/${request.operation.slice(8)}`,
        body: { tabId: request.tabId },
      };
    case "browser.load":
      return {
        method: "POST",
        path: "/v1/browser/load",
        body: { tabId: request.tabId, url: request.url },
      };
    case "browser.navigate":
      return {
        method: "POST",
        path: "/v1/browser/navigate",
        body: { tabId: request.tabId, direction: request.direction },
      };
    case "skill.list":
      return { method: "POST", path: "/v1/admin/skills/list", body: { agentId: request.agentId } };
    case "skill.install":
    case "skill.uninstall": {
      const { operation, ...body } = request;
      return { method: "POST", path: `/v1/admin/skills/${operation.slice(6)}`, body };
    }
    case "skill.toggle":
      return {
        method: "POST",
        path: "/v1/admin/skills/set-enabled",
        body: { agentId: request.agentId, skillId: request.skillId, enabled: request.enabled },
      };
    case "mcp.list":
      return { method: "GET", path: "/v1/mcp-servers", projection: "mcp-list" };
    case "mcp.save":
    case "mcp.test":
      return {
        method: "POST",
        path: `/v1/mcp-servers/${request.operation.slice(4)}`,
        body: { config: request.config },
        projection: request.operation === "mcp.save" ? "mcp-list" : "mcp-test",
      };
    case "mcp.delete":
      return {
        method: "POST",
        path: "/v1/mcp-servers/delete",
        body: { mcpServerId: request.mcpServerId },
        projection: "mcp-list",
      };
    case "mcp.toggle":
      return {
        method: "POST",
        path: "/v1/mcp-servers/toggle",
        body: { mcpServerId: request.mcpServerId, enabled: request.enabled },
        projection: "mcp-list",
      };
    case "mcp.signIn.start":
      return {
        method: "POST",
        path: "/v1/admin/mcp-servers/sign-in/start",
        body: { config: request.config },
        providerProjection: "empty",
      };
    case "mcp.signIn.status":
      return {
        method: "POST",
        path: "/v1/admin/mcp-servers/sign-in/status",
        body: { url: request.url },
        projection: "mcp-status",
      };
    case "mcp.signIn.cancel":
      return {
        method: "POST",
        path: "/v1/admin/mcp-servers/sign-in/cancel",
        body: { url: request.url },
        providerProjection: "empty",
      };
    case "mcp.signIn.list":
      return { method: "POST", path: "/v1/admin/mcp-servers/sign-ins", body: {} };
    case "mcp.signOut":
      return {
        method: "POST",
        path: "/v1/admin/mcp-servers/sign-out",
        body: { mcpServerId: request.mcpServerId },
      };
    case "connector.github.status":
    case "connector.github.connect":
    case "connector.github.cancel":
    case "connector.github.disconnect":
    case "connector.github.repositories":
      return {
        method: "POST",
        path: `/v1/admin/connectors/github/${request.operation.slice(17)}`,
        body: {},
      };
    case "connector.messaging.overview":
      return {
        method: "POST",
        path: "/v1/admin/connectors/messaging/overview",
        body: { platform: request.platform },
      };
    case "connector.messaging.connect":
      return {
        method: "POST",
        path: "/v1/admin/connectors/messaging/connect",
        body: { platform: request.platform, place: request.place },
      };
    case "connector.messaging.orchestrator":
      return {
        method: "POST",
        path: "/v1/admin/connectors/messaging/orchestrator",
        body: { platform: request.platform, workspaceId: request.workspaceId },
        projection: "messaging-orchestrator",
      };
    case "connector.messaging.disconnect":
    case "connector.messaging.reconnect":
    case "connector.messaging.enabled":
    case "connector.messaging.complete": {
      const { operation, ...body } = request;
      return {
        method: "POST",
        path: `/v1/admin/connectors/messaging/${operation.slice(20)}`,
        body,
      };
    }

    case "agent.list":
      return { method: "GET", path: "/v1/agents" };
    case "agent.create":
      return {
        method: "POST",
        path: "/v1/agents",
        body: { ...request.input, avatarSeed: "sled", avatarHue: null },
      };
    case "agent.update":
      return { method: "PATCH", path: agentPath, body: request.input };
    case "agent.delete":
      return { method: "DELETE", path: agentPath };
    case "conversation.read":
      return {
        method: "GET",
        path: `${agentPath}/conversation`,
        conversationProjection: "conversation.read",
      };
    case "conversation.send":
      return {
        method: "POST",
        path: `${agentPath}/messages`,
        body: {
          text: request.text,
          clientMessageId: request.clientMessageId,
          attachmentDraftIds: request.attachmentDraftIds ?? [],
          replyToMessageId: request.replyToMessageId ?? null,
        },
      };
    case "conversation.stop":
      return { method: "POST", path: `${agentPath}/interrupt`, body: { turnId: request.turnId } };
    case "queue.read":
      return { method: "GET", path: `${agentPath}/queue`, queueProjection: "queue.read" };
    case "task.list":
    case "task.read":
    case "task.start":
    case "task.send":
    case "task.stop":
    case "task.close":
    case "task.reopen": {
      const { operation, ...body } = request;
      return {
        method: "POST",
        path: `/v1/agent-tasks/${operation.slice(5)}`,
        body,
        ...(operation === "task.read" ? { conversationProjection: operation } : {}),
      };
    }
    case "memory.list":
      return { method: "GET", path: `${agentPath}/memories` };
    case "memory.create":
      return { method: "POST", path: `${agentPath}/memories`, body: { text: request.text } };
    case "memory.update":
      return {
        method: "PATCH",
        path: `${agentPath}/memories/${encodeURIComponent(request.memoryId)}`,
        body: { text: request.text },
      };
    case "memory.delete":
      return {
        method: "DELETE",
        path: `${agentPath}/memories/${encodeURIComponent(request.memoryId)}`,
      };
    case "routine.list":
      return { method: "GET", path: `${agentPath}/routines` };
    case "routine.runs":
      return {
        method: "GET",
        path: `${agentPath}/routines/${encodeURIComponent(request.routineId)}/runs`,
      };
    case "routine.create":
      return { method: "POST", path: `${agentPath}/routines`, body: request.input };
    case "routine.update":
      return {
        method: "PATCH",
        path: `${agentPath}/routines/${encodeURIComponent(request.routineId)}`,
        body: request.input,
      };
    case "routine.delete":
      return {
        method: "DELETE",
        path: `${agentPath}/routines/${encodeURIComponent(request.routineId)}`,
      };
    case "routine.test":
      return {
        method: "POST",
        path: `${agentPath}/routines/${encodeURIComponent(request.routineId)}/test`,
        body: {},
      };
  }
}

export interface Session {
  readonly computer?: () => Promise<ComputerViewSession.ComputerSession>;
  readonly browser?: BrowserProtocol.BrowserSession;
  readonly files: FileProtocol.FileSession<TeamClientError>;
  readonly events: Stream.Stream<EventStream.Frame, TeamClientError>;
  readonly listAgents: Effect.Effect<ReadonlyArray<typeof Agent.Type>, TeamClientError>;
  readonly close: Effect.Effect<void, TeamClientError>;
  readonly apiRead: (
    input: OpenbotReadRequest,
  ) => Effect.Effect<typeof OpenbotApiResponse.Type, TeamClientError>;
  readonly apiWrite: (
    input: OpenbotWriteRequest,
  ) => Effect.Effect<typeof OpenbotApiResponse.Type, TeamClientError>;
  readonly apiAdmin: (
    input: OpenbotAdminRequest,
  ) => Effect.Effect<typeof OpenbotApiResponse.Type, TeamClientError>;
}

export class TeamClient extends Context.Service<
  TeamClient,
  {
    readonly connect: (input: {
      readonly apiUrl: string;
      readonly ownerSecret: string;
    }) => Effect.Effect<Session, TeamClientError>;
  }
>()("t3/openbot/TeamClient") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const localHttpClient = HttpClient.transform(httpClient, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

  const send = Effect.fn("OpenbotTeamClient.send")(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* localHttpClient
      .execute(
        request.pipe(
          HttpClientRequest.setHeaders({
            "OpenBot-Protocol-Version": "9",
            "OpenBot-App-Version": "0.60.0",
            "OpenBot-Capabilities":
              "ui-blocks-v1,agent-task-ui-blocks-v1,subagents-v1,queue-edit-v1,queue-window-v1,conversation-unread,agent-threads-v1,agent-thread-reads-v1,agent-thread-branches-v1,agent-thread-replies-v1,agent-tasks-v1,agent-create-model,agent-admin-v1,agent-instructions-v1,skills-admin-v1,mcp-servers-v1,mcp-sign-in-v1,browser-navigation,browser-user-control,browser-page-state,browser-profiles-v1,connectors-v1,channel-chats-v1,providers-v8,provider-accounts-v1,provider-default-v1,provider-host-sign-in-v1,provider-sign-out-v1,custom-provider-harness-v1,custom-agents-v1,model-visibility-v1,claude-api-key-v1,sign-in-relay-v1,provider-account-relay-v1,provider-account-relay-v2,workspace-directory-v1,conversation-file-search-v1,agent-thread-files-v1,message-client-id-v1,workflows-v1,events-v1,routine-recovery-v1,webhook-tests-v1,routine-flows-v1,channel-delete-v1,channel-task-cancel-v1,channel-attention-v1,vault-v1,vault-v2,vault-import-v1,onepassword-connector-v1,bitwarden-connector-v1,remote-desktop-setup,shared-tables-v1,hosted-sites-v1,acp-registry-v1",
          }),
        ),
      )
      .pipe(Effect.mapError((cause) => new TeamClientError({ reason: "transport", cause })));
    if (response.status < 200 || response.status >= 300) {
      return yield* new TeamClientError({ reason: "http", status: response.status });
    }
    return response;
  });

  const readJson = Effect.fn("OpenbotTeamClient.readJson")(function* (
    response: HttpClientResponse.HttpClientResponse,
  ) {
    const decoder = new TextDecoder();
    // Fetch response.json does not honor MaxBodySize; bound bytes while streaming instead.
    const body = yield* response.stream.pipe(
      Stream.runFoldEffect(
        () => ({ size: 0, text: "" }),
        (state, chunk) =>
          state.size + chunk.byteLength > 1_048_576
            ? Effect.fail(new TeamClientError({ reason: "decode" }))
            : Effect.succeed({
                size: state.size + chunk.byteLength,
                text: state.text + decoder.decode(chunk, { stream: true }),
              }),
      ),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
      ),
    );
    return yield* decodeJson(body.text + decoder.decode()).pipe(
      Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      Effect.flatMap((value) =>
        Effect.try({
          try: () => CoreWire.normalize(response.request.url, value),
          catch: (cause) => new TeamClientError({ reason: "decode", cause }),
        }),
      ),
    );
  });

  const connect = Effect.fn("OpenbotTeamClient.connect")(function* (input: {
    readonly apiUrl: string;
    readonly ownerSecret: string;
  }) {
    const origin = yield* Effect.try({
      try: () => {
        const url = new URL(input.apiUrl);
        if (
          url.protocol !== "http:" ||
          !["127.0.0.1", "[::1]"].includes(url.hostname) ||
          url.username !== "" ||
          url.password !== "" ||
          url.pathname !== "/" ||
          url.search !== "" ||
          url.hash !== "" ||
          input.ownerSecret.length === 0 ||
          input.ownerSecret.length > 256
        )
          throw new Error("Invalid local endpoint");
        return url.origin;
      },
      catch: () => new TeamClientError({ reason: "invalid-configuration" }),
    });

    // Openbot v0.60.0 (0c7753fa): local owner login and roster routes in team-api-server/route-agents.
    const request = yield* HttpClientRequest.post(`${origin}/v1/auth/login`).pipe(
      HttpClientRequest.bodyJson({ username: "owner", password: input.ownerSecret }),
      Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
    );
    const login = yield* send(request).pipe(
      Effect.flatMap(readJson),
      Effect.flatMap(decodeLogin),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
      ),
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
      ),
    );
    const browserContext = yield* Effect.context<never>();
    let closed = false;
    const peers = new Set<() => void>();
    const authenticated = (path: string, method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT") =>
      HttpClientRequest.make(method)(`${origin}${path}`).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${login.sessionToken}`),
      );
    const listAgents = Effect.fn("OpenbotTeamClient.listAgents")(function* () {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      const response = yield* send(authenticated("/v1/agents", "GET"));
      return yield* readJson(response).pipe(
        Effect.flatMap(decodeRoster),
        Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      );
    });
    const close = Effect.fn("OpenbotTeamClient.close")(function* () {
      if (closed) return;
      closed = true;
      for (const closePeer of peers) closePeer();
      yield* send(authenticated("/v1/auth/logout", "POST"));
    });
    const execute = Effect.fn("OpenbotTeamClient.execute")(function* (input: ApiRequest) {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      if (input.operation === "conversation.blockRespond") {
        return yield* UiBlocks.respond(input, {
          read: Effect.fn("OpenbotTeamClient.readUiBlock")(function* (
            agentId: string,
            taskId: string | null,
          ) {
            const request =
              taskId === null
                ? authenticated(`/v1/agents/${encodeURIComponent(agentId)}/conversation`, "GET")
                : yield* HttpClientRequest.bodyJson({ agentId, taskId })(
                    authenticated("/v1/agent-tasks/read", "POST"),
                  ).pipe(
                    Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
                  );
            const response = yield* send(request);
            return yield* readJson(response).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(OpenbotConversationSnapshot)),
              Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
            );
          }),
          answer: Effect.fn("OpenbotTeamClient.answerUiBlock")(function* (
            requestId: string | number,
            answers: Record<string, string[]>,
          ) {
            const request = yield* HttpClientRequest.bodyJson({ requestId, answers })(
              authenticated("/v1/prompts/respond", "POST"),
            ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
            const response = yield* send(request);
            if (response.status !== 204) return yield* new TeamClientError({ reason: "decode" });
            return null;
          }),
        }).pipe(
          Effect.mapError((cause) =>
            isUiBlockRefused(cause)
              ? new TeamClientError({ reason: "invalid-configuration", cause })
              : cause,
          ),
        );
      }
      const route = yield* Effect.gen(function* () {
        if (!isSavedMcpRequest(input)) return apiRoute(input);
        // Stored MCP URLs and credentials stay private, including when only an origin is shown to clients.
        const rows = yield* send(authenticated("/v1/mcp-servers", "GET")).pipe(
          Effect.flatMap(readJson),
          Effect.flatMap(decodeStoredMcpRows),
          Effect.mapError((cause) =>
            isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
          ),
        );
        const config = rows.find((row) => row.id === input.mcpServerId);
        if (!config) return yield* new TeamClientError({ reason: "invalid-configuration" });
        if (input.operation === "mcp.updateById") {
          const updated = yield* decodeMcpConfig({ ...config, ...input.patch, id: config.id }).pipe(
            Effect.mapError(
              (cause) => new TeamClientError({ reason: "invalid-configuration", cause }),
            ),
          );
          return apiRoute({ operation: "mcp.save", config: updated });
        }
        if (input.operation === "mcp.testById") return apiRoute({ operation: "mcp.test", config });
        if (input.operation === "mcp.signIn.startById")
          return apiRoute({ operation: "mcp.signIn.start", config });
        return apiRoute({
          operation:
            input.operation === "mcp.signIn.statusById" ? "mcp.signIn.status" : "mcp.signIn.cancel",
          url: config.url,
        });
      });
      let request = authenticated(route.path, route.method);
      if (route.body !== undefined)
        request = yield* HttpClientRequest.bodyJson(route.body)(request).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      const responseResult = yield* send(request).pipe(Effect.result);
      if (responseResult._tag === "Failure") {
        const error = responseResult.failure;
        if (!route.dataProjection || error.reason !== "http" || error.status === 401)
          return yield* error;
        return {
          dataError:
            error.status === 400 && input.operation.endsWith(".list")
              ? "unsupported"
              : error.status === 403
                ? "forbidden"
                : error.status === 409
                  ? "account-or-conflict"
                  : "request-failed",
        };
      }
      const response = responseResult.success;
      if (response.status === 204) return null;
      const result = yield* readJson(response);
      if (route.catalogProjection)
        return yield* CatalogProtocol.project(route.catalogProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.dataProjection)
        return yield* DataProtocol.project(route.dataProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.vaultProjection)
        return yield* VaultProtocol.project(route.vaultProjection, result, route.vaultVersion).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.computerProjection)
        return yield* ComputerProtocol.project(route.computerProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.eventProjection)
        return yield* EventProtocol.project(route.eventProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.routineFlowProjection)
        return yield* RoutineFlowProtocol.project(route.routineFlowProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.conversationProjection)
        return yield* ConversationProtocol.project(route.conversationProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.queueProjection)
        return yield* QueueProtocol.project(result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.channelProjection)
        return yield* ChannelProtocol.project(route.channelProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.workflowProjection)
        return yield* WorkflowProtocol.project(route.workflowProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.providerProjection) {
        if (route.providerProjection === "empty") return {};
        const projected = yield* decodeProviderResult(route.providerProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
        if (route.providerProjection === "relayFlow") {
          const flow = yield* providerDecoders
            .relayFlow(projected)
            .pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          return {
            ...flow,
            result:
              flow.result === null
                ? null
                : {
                    error: flow.result.error === null ? null : "The provider sign-in failed.",
                    ...(flow.result.toolCount === undefined
                      ? {}
                      : { toolCount: flow.result.toolCount }),
                  },
          };
        }
        if (route.providerProjection === "signInStatus") {
          const status = yield* providerDecoders
            .signInStatus(projected)
            .pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          return {
            tabId: status.tabId,
            result:
              status.result === null
                ? null
                : { error: status.result.error === null ? null : "The provider sign-in failed." },
          };
        }
        return projected;
      }
      if (route.projection === "messaging-orchestrator")
        return yield* decodeMessagingOrchestrator(result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      // MCP administration responds with stored credentials; project them out before leaving this service.
      if (route.projection === "mcp-list")
        return yield* decodeMcpRows(result).pipe(
          Effect.map((rows) => rows.map((row) => ({ ...row, url: safeMcpUrl(row.url) }))),
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.projection === "mcp-test")
        return yield* decodeMcpResult(result).pipe(
          Effect.map(safeMcpResult),
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.projection === "mcp-status")
        return yield* decodeMcpStatus(result).pipe(
          Effect.map((value) => ({
            tabId: value.tabId,
            result: value.result === null ? null : safeMcpResult(value.result),
          })),
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      return result;
    });
    const timedExecute = (input: ApiRequest) =>
      execute(input).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
        ),
      );
    return {
      computer: () =>
        ComputerViewSession.createComputerViewSession({
          origin,
          isClosed: () => closed,
          request: (path, method, body) =>
            Effect.runPromiseWith(browserContext)(
              Effect.gen(function* () {
                if (closed) return yield* new TeamClientError({ reason: "closed" });
                let request = authenticated(path, method);
                if (body !== undefined)
                  request = yield* HttpClientRequest.bodyJson(body)(request).pipe(
                    Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
                  );
                const response = yield* send(request);
                return method === "DELETE" ? null : yield* readJson(response);
              }),
            ),
        }),
      browser: BrowserProtocol.createBrowserSession({
        origin,
        token: login.sessionToken,
        isClosed: () => closed,
        peers,
        request: (path, method, body) =>
          Effect.runPromiseWith(browserContext)(
            Effect.gen(function* () {
              if (closed) return yield* new TeamClientError({ reason: "closed" });
              let request = authenticated(path, method);
              if (body !== undefined)
                request = yield* HttpClientRequest.bodyJson(body)(request).pipe(
                  Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
                );
              const response = yield* send(request);
              return method === "DELETE" ? null : yield* readJson(response);
            }),
          ),
      }),
      files: FileProtocol.createFileSession({
        authenticated,
        send,
        json: readJson,
        isClosed: () => closed,
        isError: isTeamClientError,
        error: (reason, cause) =>
          new TeamClientError({ reason, ...(cause === undefined ? {} : { cause }) }),
      }),
      events: EventStream.connect({
        origin,
        sessionToken: login.sessionToken,
        isClosed: () => closed,
        peers,
      }).pipe(
        Stream.mapError(
          (cause) =>
            new TeamClientError({
              reason: cause.reason === "closed" ? "closed" : "transport",
              cause,
            }),
        ),
      ),
      apiRead: (input) =>
        decodeReadRequest(input).pipe(
          Effect.mapError(
            (cause) => new TeamClientError({ reason: "invalid-configuration", cause }),
          ),
          Effect.flatMap(timedExecute),
        ),
      apiWrite: (input) =>
        decodeWriteRequest(input).pipe(
          Effect.mapError(
            (cause) => new TeamClientError({ reason: "invalid-configuration", cause }),
          ),
          Effect.flatMap(timedExecute),
        ),
      apiAdmin: (input) =>
        decodeAdminRequest(input).pipe(
          Effect.mapError(
            (cause) => new TeamClientError({ reason: "invalid-configuration", cause }),
          ),
          Effect.flatMap(timedExecute),
        ),
      listAgents: listAgents().pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
        ),
      ),
      close: close().pipe(
        Effect.asVoid,
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
        ),
      ),
    } satisfies Session;
  });
  return TeamClient.of({ connect });
});

export const layer = Layer.effect(TeamClient, make);
