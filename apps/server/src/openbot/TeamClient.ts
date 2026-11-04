import {
  OpenbotReadRequest,
  OpenbotWriteRequest,
  OpenbotAdminRequest,
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
interface Route {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly projection?: "mcp-list" | "mcp-test" | "mcp-status";
  readonly providerProjection?: keyof typeof providerDecoders;
}
// Only these source-backed operations can spend the private host-owner session.
function apiRoute(request: ApiRequest): Route {
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
    case "channel.list":
      return { method: "GET", path: "/v1/channels" };
    case "channel.read":
      return {
        method: "POST",
        path: "/v1/channels/read",
        body: { channelId: request.channelId, beforeSequence: request.beforeSequence ?? null },
      };
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
      return { method: "GET", path: `${agentPath}/conversation` };
    case "conversation.send":
      return {
        method: "POST",
        path: `${agentPath}/messages`,
        body: {
          text: request.text,
          clientMessageId: request.clientMessageId,
          attachmentDraftIds: [],
          replyToMessageId: null,
        },
      };
    case "conversation.stop":
      return { method: "POST", path: `${agentPath}/interrupt`, body: { turnId: request.turnId } };
    case "queue.read":
      return { method: "GET", path: `${agentPath}/queue` };
    case "task.list":
    case "task.read":
    case "task.start":
    case "task.send":
    case "task.stop":
    case "task.close":
    case "task.reopen": {
      const { operation, ...body } = request;
      return { method: "POST", path: `/v1/agent-tasks/${operation.slice(5)}`, body };
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
              "agent-tasks-v1,agent-create-model,agent-admin-v1,agent-instructions-v1,skills-admin-v1,mcp-servers-v1,mcp-sign-in-v1,browser-navigation,browser-user-control,connectors-v1,channel-chats-v1,providers-v8,provider-accounts-v1,provider-default-v1,provider-host-sign-in-v1,provider-sign-out-v1,custom-provider-harness-v1,custom-agents-v1,model-visibility-v1,claude-api-key-v1,sign-in-relay-v1,provider-account-relay-v1,provider-account-relay-v2",
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
    let closed = false;
    const peers = new Set<() => void>();
    const authenticated = (path: string, method: "GET" | "POST" | "PATCH" | "DELETE") =>
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
      const route = apiRoute(input);
      let request = authenticated(route.path, route.method);
      if (route.body !== undefined)
        request = yield* HttpClientRequest.bodyJson(route.body)(request).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      const response = yield* send(request);
      if (response.status === 204) return null;
      const result = yield* readJson(response);
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
