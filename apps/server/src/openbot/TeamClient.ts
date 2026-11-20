import {
  OPENBOT_LIBRARY_FOLDERS_CAPABILITY,
  OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
  OPENBOT_LIBRARY_EVENTS_CAPABILITY,
  OPENBOT_MESSAGE_DELETE_CAPABILITY,
  OPENBOT_MESSAGE_PINS_CAPABILITY,
  SLED_CONNECT_WEBHOOKS_ROUTES,
} from "@t3tools/contracts";
import {
  OpenbotTransferSummary,
  OpenbotTransferPreview,
  OpenbotTransferResult,
} from "@t3tools/contracts/openbot-instance-transfer";
import * as DirectProtocol from "./DirectProtocol.ts";
import { catalogMatches } from "./McpCatalog.ts";
import * as BrowserDisplayProtocol from "./BrowserDisplayProtocol.ts";
import { createTeamPrivilegedClient, type PrivilegedTransport } from "./TeamPrivilegedClient.ts";
import { signQueueAttachmentsBinding } from "./QueueAttachmentsBinding.ts";
// @effect-diagnostics nodeBuiltinImport:off -- authenticated import body digest.
import { createHash } from "node:crypto";
import * as Clock from "effect/Clock";
import {
  type ImportRequest,
  type ImportReceipt,
  IMPORT_CAPABILITY,
} from "@t3tools/contracts/openbot-agent-import";
import { importRoute, importStageRoute, projectImportReceipt } from "./ImportProtocol.ts";
import { signFilesPrincipalBinding } from "./FilesPrincipalBinding.ts";
import { signImportBinding } from "./ImportBinding.ts";
import * as SettingsProtocol from "./SettingsProtocol.ts";
import * as TemplateProtocol from "./TemplateProtocol.ts";
import * as ChannelCodingTransport from "./ChannelCodingTransport.ts";
import * as UiBlocks from "./UiBlocks.ts";
import { OpenbotAgent, OpenbotConversationSnapshot } from "@t3tools/contracts";
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
  OpenbotChannelCodingReceipt,
  type OpenbotApiResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  OPENBOT_LIVE_VOICE_ROUTES,
  OpenbotLiveVoiceAnswer,
  type OpenbotLiveVoiceOffer,
} from "@t3tools/contracts";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as EventStream from "./EventStream.ts";
import * as FileProtocol from "./FileProtocol.ts";
import * as WorkflowProtocol from "./WorkflowProtocol.ts";
import * as ChannelProtocol from "./ChannelProtocol.ts";
import * as CoreWire from "./CoreWire.ts";

const decodeQueueAttachmentHost = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ hostId: Schema.String })),
);

export class TeamClientError extends Schema.TaggedError<TeamClientError>()(
  "OpenbotTeamClientError",
  {
    reason: Schema.Literals(["invalid-configuration", "transport", "http", "decode", "closed"]),
    status: Schema.optional(Schema.Number),
    publicCode: Schema.optional(Schema.Literal("host_account_required")),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "The local Openbot connection could not complete the request.";
  }
}

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const decodeConnectWebhookConfiguration = Schema.decodeUnknownEffect(
  Schema.Struct({ routeId: Identifier }),
);
const decodeConnectWebhookStatus = Schema.decodeUnknownEffect(
  Schema.Struct({ status: Schema.Literals([200, 202, 400, 401, 404, 413, 503]) }),
);
const Agent = Schema.Struct({
  ...OpenbotAgent.fields,
  id: Identifier,
  name: Schema.String.check(Schema.isMaxLength(256)),
  provider: Identifier,
});
function avatarVersion(
  agentId: string,
  raw: string | null | undefined,
  origin: string,
): { avatarVersion?: string } {
  if (!raw) return {};
  try {
    const url = new URL(raw, origin);
    const internal =
      url.protocol === "openbot-avatar:" &&
      url.hostname === "agent" &&
      decodeURIComponent(url.pathname.slice(1)) === agentId;
    const team =
      url.origin === origin && url.pathname === `/v1/agents/${encodeURIComponent(agentId)}/avatar`;
    const version = url.searchParams.get("v");
    return (internal || team) &&
      version &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(version)
      ? { avatarVersion: version }
      : {};
  } catch {
    return {};
  }
}
const Roster = Schema.Array(
  Schema.Struct({
    ...Agent.fields,
    marketplaceSource: Schema.optional(Schema.NullOr(Schema.Struct({ agentId: Identifier }))),
    avatarUrl: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048)))),
  }),
).check(Schema.isMaxLength(10_000));
const Login = Schema.Struct({
  sessionToken: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  sessionExpiresAt: Schema.String.check(Schema.isMaxLength(64)),
});

const isTeamClientError = Schema.is(TeamClientError);
const isUiBlockRefused = Schema.is(UiBlocks.UiBlockRefused);
const decodeLiveVoiceAnswer = Schema.decodeUnknownEffect(OpenbotLiveVoiceAnswer);
const decodeLogin = Schema.decodeUnknownEffect(Login);
const decodeRoster = Schema.decodeUnknownEffect(Roster);
const SafeMcpRow = Schema.Struct({
  id: Identifier,
  name: Schema.String,
  transport: Schema.Literals(["stdio", "http"]),
  enabled: Schema.Boolean,
  url: Schema.String,
  command: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  envPassthrough: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(255))).check(Schema.isMaxLength(64)),
  ),
  args: Schema.optional(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(64))),
  env: Schema.optional(
    Schema.Array(Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(255)) })).check(
      Schema.isMaxLength(64),
    ),
  ),
  headers: Schema.optional(
    Schema.Array(Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(255)) })).check(
      Schema.isMaxLength(32),
    ),
  ),
  workingDirectory: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
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
  usageResets: Schema.decodeUnknownEffect(
    Schema.Struct({
      accounts: Schema.Array(
        Schema.Struct({
          provider: ProviderId,
          accountId: AccountId,
          available: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      ).check(Schema.isMaxLength(10)),
    }),
  ),
  usageResetResult: Schema.decodeUnknownEffect(
    Schema.Struct({
      outcome: Schema.Literals(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]),
    }),
  ),
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

type ApiRequest =
  | Exclude<OpenbotReadRequest, { operation: "context.read" }>
  | OpenbotWriteRequest
  | OpenbotAdminRequest;
type SavedMcpRequest = Extract<
  ApiRequest,
  {
    operation:
      | "mcp.testCredentialsById"
      | "mcp.saveCredentialsById"
      | "mcp.signInRelay.startById"
      | "mcp.testPatchById"
      | "mcp.updateById"
      | "mcp.testById"
      | "mcp.signIn.startById"
      | "mcp.signIn.statusById"
      | "mcp.signIn.cancelById";
  }
>;
function isSavedMcpRequest(request: ApiRequest): request is SavedMcpRequest {
  return (
    request.operation === "mcp.testCredentialsById" ||
    request.operation === "mcp.saveCredentialsById" ||
    request.operation === "mcp.signInRelay.startById" ||
    request.operation === "mcp.testPatchById" ||
    request.operation === "mcp.updateById" ||
    request.operation === "mcp.testById" ||
    request.operation === "mcp.signIn.startById" ||
    request.operation === "mcp.signIn.statusById" ||
    request.operation === "mcp.signIn.cancelById"
  );
}
interface Route {
  readonly directProjection?: Parameters<typeof DirectProtocol.project>[0];
  readonly settingsProjection?: string;
  readonly templateProjection?: Parameters<typeof TemplateProtocol.project>[0];
  readonly catalogProjection?: Parameters<typeof CatalogProtocol.project>[0];
  readonly dataProjection?: Parameters<typeof DataProtocol.project>[0];
  readonly vaultProjection?: Parameters<typeof VaultProtocol.project>[0];
  readonly vaultVersion?: Parameters<typeof VaultProtocol.project>[2];
  readonly method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  readonly path: string;
  readonly body?: unknown;
  readonly avatarImage?: { readonly mimeType: string; readonly dataBase64: string };
  readonly avatarRead?: boolean;
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
function apiRoute(
  request: Exclude<ApiRequest, SavedMcpRequest | { operation: "library.files.preview" }>,
): Route {
  if (DirectProtocol.isRequest(request)) return DirectProtocol.route(request);
  if (SettingsProtocol.isRequest(request)) return SettingsProtocol.route(request);
  if (TemplateProtocol.isRequest(request)) return TemplateProtocol.route(request);
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
    "agentId" in request && typeof request.agentId === "string"
      ? `/v1/agents/${encodeURIComponent(request.agentId)}`
      : "/v1/agents";
  switch (request.operation) {
    case "mcp.catalogMatches":
      return { method: "GET", path: "/v1/mcp-servers" };
    case "mcp.signInRelay.start":
      return {
        method: "POST",
        path: "/v1/admin/sign-in-relay/mcp/start",
        body: { config: request.config },
        providerProjection: "relayStarted",
      };
    case "provider.usageResets.list":
      return {
        method: "POST",
        path: "/v1/admin/providers/usage-reset/list",
        body: { provider: request.provider },
        providerProjection: "usageResets",
      };
    case "provider.usageResets.consume":
      return {
        method: "POST",
        path: "/v1/admin/providers/usage-reset/consume",
        body: { provider: request.provider, accountId: request.accountId },
        providerProjection: "usageResetResult",
      };
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
    case "workspace.usage":
      return { method: "GET", path: "/v1/agents/usage" };
    case "agent.usage":
      return { method: "GET", path: `/v1/agents/${encodeURIComponent(request.agentId)}/usage` };
    case "workspace.analytics":
    case "agent.analytics": {
      const query = new URLSearchParams({
        startDate: request.startDate,
        endDate: request.endDate,
        timeZone: request.timeZone,
      });
      if (request.operation === "workspace.analytics" && request.agentId)
        query.set("agentId", request.agentId);
      const path =
        request.operation === "agent.analytics"
          ? `/v1/agents/${encodeURIComponent(request.agentId)}/analytics`
          : "/v1/analytics";
      return { method: "GET", path: `${path}?${query}` };
    }
    case "workspace.identity":
      return { method: "GET", path: "/v1/identity" };
    case "workspace.member":
      return { method: "GET", path: "/v1/me" };
    case "workspace.reads":
      return { method: "GET", path: "/v1/agents/conversation-reads" };
    case "workspace.sidebar":
      return { method: "GET", path: "/v1/sidebar-layout" };
    case "workspace.presence":
      return { method: "GET", path: "/v1/team/presence" };
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
        body: {
          url: request.url,
          focus: request.focus,
          ownerThreadId: request.ownerThreadId ?? null,
          ownerBotId: request.ownerAgentId ?? null,
        },
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
        body: { avatarSeed: "sled", avatarHue: null, ...request.input },
      };
    case "agent.avatar.read":
      return {
        method: "GET",
        path: `${agentPath}/avatar?${new URLSearchParams({ v: request.version })}`,
        avatarRead: true,
      };
    case "agent.avatar.set":
      return request.image === null
        ? { method: "DELETE", path: `${agentPath}/avatar` }
        : { method: "PUT", path: `${agentPath}/avatar`, avatarImage: request.image };
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
    case "memory.clear":
      return { method: "DELETE", path: `${agentPath}/memories` };
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
  readonly connectWebhooks?: {
    configuration: (input: {
      owner: { kind: "agent"; id: string };
      id: string;
    }) => Effect.Effect<{ routeId: string }, TeamClientError>;
    receive: (input: {
      routeId: string;
      deliveryId: string;
      timestamp: string;
      signature: string;
      body: Uint8Array;
    }) => Effect.Effect<{ status: number }, TeamClientError>;
  };
  readonly instanceTransfer?: {
    readonly summary: Effect.Effect<Schema.Json, TeamClientError>;
    readonly exportZip: (input: {
      agentIds: readonly string[];
      includeFiles: boolean;
      includeSettings: boolean;
    }) => Effect.Effect<
      { size: number; body: Stream.Stream<Uint8Array, TeamClientError> },
      TeamClientError
    >;
    readonly stage: (bytes: Uint8Array) => Effect.Effect<Schema.Json, TeamClientError>;
    readonly apply: (input: {
      token: string;
      keys: readonly string[];
      includeSettings: boolean;
      timezone: string;
    }) => Effect.Effect<Schema.Json, TeamClientError>;
    readonly discard: (token: string) => Effect.Effect<void, TeamClientError>;
  };
  readonly privileged?: PrivilegedTransport;
  readonly agentImport?: {
    readonly available: Effect.Effect<boolean, TeamClientError>;
    readonly execute: (
      principal: string,
      request: ImportRequest,
      bytes?: Uint8Array,
    ) => Effect.Effect<ImportReceipt | null, TeamClientError>;
  };
  readonly channel?: ChannelCodingTransport.ChannelCodingTransport;
  readonly computer?: () => Promise<ComputerViewSession.ComputerSession>;
  readonly browser?: BrowserProtocol.BrowserSession;
  readonly files: FileProtocol.FileSession<TeamClientError>;
  readonly liveVoice?: {
    readonly start: (
      offer: OpenbotLiveVoiceOffer,
    ) => Effect.Effect<OpenbotLiveVoiceAnswer, TeamClientError>;
    readonly stop: (sessionId: string) => Effect.Effect<void, TeamClientError>;
  };
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
              "sled-public-catalog-v1,sled-connect-webhooks-v1,sled-connect-workflow-webhooks-v1,sled-once-routines-v1,sled-conversation-paging-v1,sled-channel-presentation-v1,sled-channel-trace-v1,instance-transfer-v1,installed-skills,host-account-v1,mcp-accounts-v1,provider-usage-reset-v1,host-analytics,agent-analytics,sled-privileged-responses-v1,sled-queue-attachments-v1,sled-agent-import-v1,sled-files-identity-v1,sled-files-upload-recovery-v1,storage-v1,storage-disk-v1,sidebar-folders-v1,side-question-v1,workflows-github-v1,routine-results-v1,local-skill-catalog-v1,agent-access-v1,agent-backup-models-v1,agent-fast-mode-v1,agent-folders-v1,agent-hidden-v1,agent-hidden-work,agent-host-settings-v1,agent-defaults-v1,background-processes-v1,agent-memories-v1,agent-memory-limit-v1,agent-new-chat-v1,agent-notification-levels-v1,agent-plan-card-v1,agent-session-settings-v1,agent-task-limit-v1,context-compact-v1,context-reset-v1,discord-access-v1,host-timezone-v1,memory-review-v1,prompt-cache-ttl-v1,sidebar-pins-v1,sled-channel-coding-assignment-v1,agent-review-v1,agent-adoption-v1,live-voice-v1,ui-blocks-v1,agent-task-ui-blocks-v1,subagents-v1,memory-changes-v1,queue-edit-v1,queue-window-v1,conversation-unread,agent-threads-v1,agent-thread-reads-v1,agent-thread-branches-v1,agent-thread-replies-v1,agent-tasks-v1,agent-create-model,agent-admin-v1,agent-instructions-v1,skills-admin-v1,mcp-servers-v1,mcp-sign-in-v1,browser-navigation,browser-user-control,browser-page-state,browser-profiles-v1,browser-proxies-v1,connectors-v1,channel-chats-v1,providers-v8,provider-accounts-v1,provider-default-v1,provider-host-sign-in-v1,provider-sign-out-v1,custom-provider-harness-v1,custom-agents-v1,model-visibility-v1,claude-api-key-v1,sign-in-relay-v1,provider-account-relay-v1,provider-account-relay-v2,workspace-directory-v1,conversation-file-search-v1,agent-thread-files-v1,message-client-id-v1,workflows-v1,events-v1,routine-recovery-v1,webhook-tests-v1,routine-flows-v1,channel-delete-v1,channel-task-cancel-v1,channel-attention-v1,vault-v1,vault-v2,vault-v3,vault-v4,vault-import-v1,onepassword-connector-v1,bitwarden-connector-v1,remote-desktop-setup,shared-tables-v1,hosted-sites-v1,acp-registry-v1,agent-install-v1,agent-update-v1,agent-publish-v1" +
              "," +
              [
                OPENBOT_MESSAGE_DELETE_CAPABILITY,
                OPENBOT_MESSAGE_PINS_CAPABILITY,
                OPENBOT_LIBRARY_FOLDERS_CAPABILITY,
                OPENBOT_LIBRARY_EVENTS_CAPABILITY,
                OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
              ].join(","),
          }),
        ),
      )
      .pipe(Effect.mapError((cause) => new TeamClientError({ reason: "transport", cause })));
    if (response.status === 409 && new URL(request.url).pathname.startsWith("/v1/admin/catalog/")) {
      const payload = yield* readJson(response).pipe(Effect.result);
      if (
        payload._tag === "Success" &&
        Schema.is(Schema.Struct({ code: Schema.Literal("host_account_required") }))(payload.success)
      )
        return yield* new TeamClientError({
          reason: "http",
          status: 409,
          publicCode: "host_account_required",
        });
    }
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
        Effect.map((rows) =>
          rows.map((row) => {
            const { avatarUrl, marketplaceSource, ...rest } = row;
            return {
              ...rest,
              ...(marketplaceSource ? { listingId: marketplaceSource.agentId } : {}),
              ...avatarVersion(row.id, avatarUrl, origin),
            };
          }),
        ),
        Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      );
    });
    const channelPost = Effect.fn("OpenbotTeamClient.channelPost")(function* <A>(
      path: (typeof ChannelCodingTransport.CHANNEL_CODING_PATHS)[keyof typeof ChannelCodingTransport.CHANNEL_CODING_PATHS],
      input: Schema.Json,
      schema: Schema.Codec<A>,
    ) {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      const request = yield* HttpClientRequest.bodyJson(input)(authenticated(path, "POST")).pipe(
        Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      );
      const response = yield* send(request);
      return yield* readJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
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
      if (input.operation === "library.files.preview")
        return yield* new TeamClientError({ reason: "invalid-configuration" });
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
        if (input.operation === "mcp.signInRelay.startById")
          return apiRoute({ operation: "mcp.signInRelay.start", config });
        if (
          input.operation === "mcp.testCredentialsById" ||
          input.operation === "mcp.saveCredentialsById"
        ) {
          const merge = (
            kept: readonly { key: string; value: string }[],
            written: readonly { key: string; value: string }[] | undefined,
          ) =>
            written
              ? [
                  ...kept.filter((pair) => !written.some((next) => next.key === pair.key)),
                  ...written,
                ]
              : kept;
          const updated = yield* decodeMcpConfig({
            ...config,
            headers: merge(config.headers, input.headers),
            env: merge(config.env, input.env),
            url: input.url ?? config.url,
          }).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          return apiRoute({
            operation: input.operation === "mcp.testCredentialsById" ? "mcp.test" : "mcp.save",
            config: updated,
          });
        }
        if (input.operation === "mcp.updateById" || input.operation === "mcp.testPatchById") {
          const updated = yield* decodeMcpConfig({ ...config, ...input.patch, id: config.id }).pipe(
            Effect.mapError(
              (cause) => new TeamClientError({ reason: "invalid-configuration", cause }),
            ),
          );
          return apiRoute({
            operation: input.operation === "mcp.testPatchById" ? "mcp.test" : "mcp.save",
            config: updated,
          });
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
      if (route.avatarImage) {
        const bytes = Buffer.from(route.avatarImage.dataBase64, "base64");
        if (
          bytes.length === 0 ||
          bytes.length > 524288 ||
          bytes.toString("base64") !== route.avatarImage.dataBase64
        )
          return yield* new TeamClientError({ reason: "decode" });
        request = HttpClientRequest.bodyUint8Array(bytes, route.avatarImage.mimeType)(request);
      }
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
      if (route.avatarRead) {
        const mimeType = response.headers["content-type"]?.split(";", 1)[0]?.trim();
        if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType))
          return yield* new TeamClientError({ reason: "decode" });
        const chunks = yield* response.stream.pipe(
          Stream.runFoldEffect(
            () => ({ size: 0, parts: [] as Uint8Array[] }),
            (state, chunk) =>
              state.size + chunk.byteLength > 524288
                ? Effect.fail(new TeamClientError({ reason: "decode" }))
                : Effect.succeed({
                    size: state.size + chunk.byteLength,
                    parts: [...state.parts, chunk],
                  }),
          ),
          Effect.mapError((cause) =>
            isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
          ),
        );
        if (!chunks.size) return yield* new TeamClientError({ reason: "decode" });
        return { mimeType, dataBase64: Buffer.concat(chunks.parts).toString("base64") };
      }
      const result = yield* readJson(response);
      if (input.operation === "mcp.catalogMatches")
        return yield* decodeStoredMcpRows(result).pipe(
          Effect.map((rows) => catalogMatches(input.apps, rows)),
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (input.operation === "browser.display") {
        const snapshot = Effect.fn("OpenbotTeamClient.browserState")(function* (path: string) {
          const request = yield* HttpClientRequest.bodyJson({})(authenticated(path, "POST")).pipe(
            Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
          );
          return yield* send(request).pipe(Effect.flatMap(readJson));
        });
        const optionalSnapshot = (path: string) =>
          snapshot(path).pipe(
            Effect.catchIf(
              (error) => error.reason === "http" && (error.status === 400 || error.status === 404),
              () => Effect.succeed(null),
            ),
          );
        const held = yield* optionalSnapshot("/v1/browser/user-control");
        const pages = yield* optionalSnapshot("/v1/browser/page-state");
        return yield* BrowserDisplayProtocol.project(result, held, pages).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      }
      if (route.directProjection)
        return yield* DirectProtocol.project(route.directProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.settingsProjection)
        return yield* SettingsProtocol.project(route.settingsProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
      if (route.templateProjection)
        return yield* TemplateProtocol.project(route.templateProjection, result).pipe(
          Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
        );
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
      if (input.operation === "events.configuration")
        return yield* EventProtocol.configuration(input, result).pipe(
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
          Effect.map((rows) =>
            rows.map(({ args, env, headers, ...row }) => ({
              ...row,
              url: safeMcpUrl(row.url),
              ...(args ? { argsCount: args.length } : {}),
              ...(env ? { envNames: env.map((pair) => pair.key) } : {}),
              ...(headers ? { headerNames: headers.map((pair) => pair.key) } : {}),
            })),
          ),
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
    const importAvailable = Effect.gen(function* () {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      const value = yield* send(authenticated("/v1/compatibility", "GET")).pipe(
        Effect.flatMap(readJson),
      );
      return (
        typeof value === "object" &&
        value !== null &&
        "capabilities" in value &&
        Array.isArray(value.capabilities) &&
        value.capabilities.includes(IMPORT_CAPABILITY)
      );
    });
    const transferJson = Effect.fn("OpenbotTeamClient.instanceTransferJson")(function* <A>(
      operation: "summary" | "apply" | "discard",
      body: unknown,
      schema: Schema.Codec<A>,
    ) {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      const request = yield* HttpClientRequest.bodyJson(
        authenticated(`/v1/instance-transfer/${operation}`, "POST"),
        body,
      ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
      const result = yield* send(request).pipe(Effect.flatMap(readJson));
      return yield* Schema.decodeUnknownEffect(schema)(result).pipe(
        Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      );
    });
    return {
      instanceTransfer: {
        summary: transferJson("summary", {}, OpenbotTransferSummary),
        apply: (input) => transferJson("apply", input, OpenbotTransferResult),
        discard: (token) => transferJson("discard", { token }, Schema.Unknown).pipe(Effect.asVoid),
        stage: Effect.fn("OpenbotTeamClient.stageTransfer")(function* (bytes) {
          if (closed || bytes.byteLength < 1 || bytes.byteLength > 104857600)
            return yield* new TeamClientError({ reason: "decode" });
          const result = yield* send(
            authenticated("/v1/instance-transfer/stage", "POST").pipe(
              HttpClientRequest.bodyUint8Array(bytes, "application/zip"),
            ),
          ).pipe(Effect.flatMap(readJson));
          return yield* Schema.decodeUnknownEffect(OpenbotTransferPreview)(result).pipe(
            Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
          );
        }),
        exportZip: Effect.fn("OpenbotTeamClient.exportTransfer")(function* (body) {
          if (closed) return yield* new TeamClientError({ reason: "closed" });
          const request = yield* HttpClientRequest.bodyJson(
            authenticated("/v1/instance-transfer/export", "POST"),
            {
              agentIds: body.agentIds,
              includeFiles: body.includeFiles,
              includeSettings: body.includeSettings,
            },
          ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          const response = yield* send(request);
          const size = Number(response.headers["content-length"]);
          if (
            response.headers["content-type"]?.split(";", 1)[0] !== "application/zip" ||
            !Number.isSafeInteger(size) ||
            size < 1 ||
            size > 104857600
          )
            return yield* new TeamClientError({ reason: "decode" });
          return {
            size,
            body: response.stream.pipe(
              Stream.mapError((cause) => new TeamClientError({ reason: "transport", cause })),
            ),
          };
        }),
      },
      connectWebhooks: {
        configuration: Effect.fn("TeamClient.connectWebhookConfiguration")(function* (input) {
          if (closed) return yield* new TeamClientError({ reason: "closed" });
          const request = yield* HttpClientRequest.bodyJson(input)(
            authenticated(SLED_CONNECT_WEBHOOKS_ROUTES.configuration, "POST"),
          ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          return yield* send(request).pipe(
            Effect.flatMap(readJson),
            Effect.flatMap(decodeConnectWebhookConfiguration),
            Effect.mapError((cause) =>
              isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
            ),
          );
        }),
        receive: Effect.fn("TeamClient.receiveConnectWebhook")(function* (input) {
          if (closed) return yield* new TeamClientError({ reason: "closed" });
          if (input.body.length > 65536) return { status: 413 };
          const { body, ...metadata } = input;
          const request = yield* HttpClientRequest.bodyJson({
            ...metadata,
            bodyBase64: Buffer.from(body).toString("base64"),
          })(authenticated(SLED_CONNECT_WEBHOOKS_ROUTES.receive, "POST")).pipe(
            Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
          );
          return yield* send(request).pipe(
            Effect.flatMap(readJson),
            Effect.flatMap(decodeConnectWebhookStatus),
            Effect.mapError((cause) =>
              isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
            ),
          );
        }),
      },
      privileged: createTeamPrivilegedClient({
        secret: input.ownerSecret,
        isClosed: () => closed,
        authenticated,
        send,
        json: readJson,
      }),
      agentImport: {
        available: importAvailable,
        execute: Effect.fn("OpenbotTeamClient.agentImport")(function* (principal, request, bytes) {
          if (!(yield* importAvailable))
            return yield* new TeamClientError({ reason: "invalid-configuration" });
          const route =
            request.operation === "import.stage"
              ? importStageRoute(request.requestId)
              : importRoute(request);
          const body =
            request.operation === "import.stage"
              ? bytes
              : Buffer.from(
                  yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
                    importRoute(request).body,
                  ).pipe(
                    Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
                  ),
                );
          if (!body || body.byteLength > 104857600)
            return yield* new TeamClientError({ reason: "decode" });
          const now = yield* Clock.currentTimeMillis;
          const token = yield* Effect.try({
            try: () =>
              signImportBinding(
                input.ownerSecret,
                {
                  principal,
                  hostId: request.hostId,
                  method: "POST",
                  path: route.path,
                  bodySha256: createHash("sha256").update(body).digest("hex"),
                },
                now,
              ),
            catch: (cause) => new TeamClientError({ reason: "decode", cause }),
          });
          const http = authenticated(route.path, "POST").pipe(
            HttpClientRequest.setHeader("x-sled-import-principal", token),
            HttpClientRequest.bodyUint8Array(
              body,
              request.operation === "import.stage" ? "application/zip" : "application/json",
            ),
          );
          const value = yield* send(http).pipe(Effect.flatMap(readJson));
          return yield* Effect.try({
            try: () => projectImportReceipt(value),
            catch: (cause) => new TeamClientError({ reason: "decode", cause }),
          });
        }),
      },
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
      channel: {
        progressAvailable: channelPost(
          ChannelCodingTransport.CHANNEL_CODING_PATHS.available,
          {},
          ChannelCodingTransport.ChannelStatus,
        ).pipe(
          Effect.map(
            (status) =>
              status.available && status.progressCapability === "sled-channel-coding-progress-v1",
          ),
          Effect.catchIf(
            (cause) => cause.reason === "http" && cause.status === 404,
            () => Effect.succeed(false),
          ),
        ),
        progress: (credential, event) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.progress,
            { credential, event },
            ChannelCodingTransport.CodingProgressReceipt,
          ),
        configure: (mcpServerId) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.configure,
            { mcpServerId },
            Schema.Struct({ configured: Schema.Literal(true) }),
          ),
        available: channelPost(
          ChannelCodingTransport.CHANNEL_CODING_PATHS.available,
          {},
          ChannelCodingTransport.ChannelStatus,
        ).pipe(
          Effect.map((status) => status.available),
          Effect.catchIf(
            (cause) => cause.reason === "http" && cause.status === 404,
            () => Effect.succeed(false),
          ),
        ),
        send: (originRef, command) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.send,
            { originRef, command },
            ChannelCodingTransport.AttributedReceipt,
          ),
        recover: (originRef, channelId, operationId) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.recover,
            { originRef, channelId, operationId },
            Schema.NullOr(ChannelCodingTransport.AttributedReceipt),
          ),
        verify: (credential, purpose) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.verify,
            { credential, purpose },
            ChannelCodingTransport.VerifiedAssignment,
          ),
        receipt: (credential) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.receipt,
            { credential },
            Schema.NullOr(OpenbotChannelCodingReceipt),
          ),
        renew: (credential) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.renew,
            { credential },
            OpenbotChannelCodingReceipt,
          ),
        submit: (credential, text) =>
          channelPost(
            ChannelCodingTransport.CHANNEL_CODING_PATHS.submit,
            { credential, text },
            OpenbotChannelCodingReceipt,
          ),
      },
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
      liveVoice: {
        start: Effect.fn("OpenbotTeamClient.startLiveVoice")(function* (offer) {
          if (closed) return yield* new TeamClientError({ reason: "closed" });
          const request = yield* HttpClientRequest.bodyJson(offer)(
            authenticated(OPENBOT_LIVE_VOICE_ROUTES.start, "POST"),
          ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          return yield* send(request).pipe(
            Effect.flatMap(readJson),
            Effect.flatMap(decodeLiveVoiceAnswer),
            Effect.mapError((cause) =>
              isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
            ),
          );
        }),
        stop: Effect.fn("OpenbotTeamClient.stopLiveVoice")(function* (sessionId) {
          if (closed) return;
          const request = yield* HttpClientRequest.bodyJson({ sessionId })(
            authenticated(OPENBOT_LIVE_VOICE_ROUTES.stop, "POST"),
          ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          yield* send(request);
        }),
      },
      files: FileProtocol.createFileSession({
        signedQueueAttachments: Effect.fn("TeamClient.signedQueueAttachments")(
          function* (principal, path, body) {
            if (closed) return yield* new TeamClientError({ reason: "closed" });
            const decoded = yield* decodeQueueAttachmentHost(body).pipe(
              Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
            );
            const bytes = Buffer.from(body);
            if (bytes.byteLength > 160000) return yield* new TeamClientError({ reason: "decode" });
            const now = yield* Clock.currentTimeMillis;
            const token = yield* Effect.try({
              try: () =>
                signQueueAttachmentsBinding(
                  input.ownerSecret,
                  {
                    principal,
                    hostId: decoded.hostId,
                    method: "POST",
                    path,
                    bodySha256: createHash("sha256").update(bytes).digest("hex"),
                  },
                  now,
                ),
              catch: (cause) => new TeamClientError({ reason: "decode", cause }),
            });
            return yield* send(
              authenticated(path, "POST").pipe(
                HttpClientRequest.setHeader("x-sled-queue-attachments", token),
                HttpClientRequest.bodyUint8Array(bytes, "application/json"),
              ),
            ).pipe(Effect.flatMap(readJson));
          },
        ),
        signedFiles: Effect.fn("OpenbotTeamClient.signedFiles")(function* (principal, path, body) {
          if (closed) return yield* new TeamClientError({ reason: "closed" });
          if (
            typeof body !== "object" ||
            body === null ||
            !("hostId" in body) ||
            typeof body.hostId !== "string"
          )
            return yield* new TeamClientError({ reason: "decode" });
          const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
            body,
          ).pipe(Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })));
          const bytes = Buffer.from(encoded);
          if (bytes.byteLength > 139_820_000)
            return yield* new TeamClientError({ reason: "decode" });
          const now = yield* Clock.currentTimeMillis;
          const hostId = body.hostId;
          const token = yield* Effect.try({
            try: () =>
              signFilesPrincipalBinding(
                input.ownerSecret,
                {
                  principal,
                  hostId,
                  method: "POST",
                  path,
                  bodySha256: createHash("sha256").update(bytes).digest("hex"),
                },
                now,
              ),
            catch: (cause) => new TeamClientError({ reason: "decode", cause }),
          });
          return yield* send(
            authenticated(path, "POST").pipe(
              HttpClientRequest.setHeader("x-sled-files-principal", token),
              HttpClientRequest.bodyUint8Array(bytes, "application/json"),
            ),
          ).pipe(Effect.flatMap(readJson));
        }),
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
          Effect.flatMap((request) =>
            request.operation === "context.read" ? Effect.succeed(null) : timedExecute(request),
          ),
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
