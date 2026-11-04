import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotMcpConfig,
  OpenbotMcpPatch,
  OpenbotMessagingOrchestratorRequest,
  type OpenbotAdminRequest,
} from "@t3tools/contracts";

const Text = Schema.String.check(Schema.isMaxLength(4096));
const NullableText = Schema.NullOr(Text);
const Mcp = Schema.Struct({
  id: Text,
  name: Text,
  transport: Schema.Literals(["stdio", "http"]),
  enabled: Schema.Boolean,
  url: Text,
});
const McpRows = Schema.Array(Mcp).check(Schema.isMaxLength(1000));
const SignIns = Schema.Array(Schema.Struct({ mcpServerId: Text, signedIn: Schema.Boolean }));
const TestResult = Schema.Struct({ toolCount: Schema.Int, error: NullableText });
const SignInStatus = Schema.Struct({ tabId: NullableText, result: Schema.NullOr(TestResult) });
const GitHub = Schema.Struct({
  available: Schema.Boolean,
  state: Schema.Literals(["disconnected", "pending", "connected", "expired"]),
  login: NullableText,
  userCode: NullableText,
  verificationUri: NullableText,
  installUrl: NullableText,
  revokeUrl: NullableText,
  error: NullableText,
});
const Repositories = Schema.Struct({
  repositories: Schema.Array(Schema.Struct({ fullName: Text, private: Schema.Boolean })).check(
    Schema.isMaxLength(500),
  ),
  total: Schema.Int,
});
const Platform = Schema.Literals(["slack", "discord", "telegram"]);
export type BotMessagingPlatform = typeof Platform.Type;
const Messaging = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      workspaceId: Text,
      platform: Platform,
      enabled: Schema.Boolean,
      state: Text,
      workspaceName: Text,
      missingScopes: Schema.Array(Text),
      retryAt: NullableText,
      credentials: Text,
      orchestratorAgentId: NullableText,
    }),
  ).check(Schema.isMaxLength(64)),
});
const Page = Schema.Struct({ url: NullableText, nonce: NullableText });
const Agents = Schema.Array(Schema.Struct({ id: Text, name: Text, provider: Text }));
export type BotConnectionAgent = (typeof Agents.Type)[number];
export type BotMessagingConnection = (typeof Messaging.Type.connections)[number];
const ConnectorIdentifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const decodeOrchestrator = Schema.decodeUnknownResult(
  Schema.Struct({ agentId: ConnectorIdentifier, sectionId: Schema.NullOr(ConnectorIdentifier) }),
);
const decodeOrchestratorRequest = Schema.decodeUnknownResult(OpenbotMessagingOrchestratorRequest);
const Skill = Schema.Struct({
  skillId: Text,
  name: Text,
  slug: Text,
  installedVersion: Schema.Int,
  availableVersion: Schema.Int,
  state: Schema.Literals(["installed", "update-available", "modified", "needs-repair"]),
  enabled: Schema.optional(Schema.Boolean),
  origin: Schema.optional(Schema.Literals(["marketplace", "managed", "local", "workspace"])),
  description: Schema.optional(Text),
  problem: Schema.optional(Text),
});
const Skills = Schema.Array(Skill).check(Schema.isMaxLength(1000));
const decodeMcp = Schema.decodeUnknownResult(McpRows);
const decodeSignIns = Schema.decodeUnknownResult(SignIns);
const decodeTest = Schema.decodeUnknownResult(TestResult);
const decodeSignIn = Schema.decodeUnknownResult(SignInStatus);
const decodeGitHub = Schema.decodeUnknownResult(GitHub);
const decodeRepositories = Schema.decodeUnknownResult(Repositories);
const decodeMessaging = Schema.decodeUnknownResult(Messaging);
const decodePage = Schema.decodeUnknownResult(Page);
const decodeAgents = Schema.decodeUnknownResult(Agents);
const decodeSkills = Schema.decodeUnknownResult(Skills);
const decodeSkill = Schema.decodeUnknownResult(Skill);
const decodeAccepted = Schema.decodeUnknownResult(Schema.Struct({ accepted: Schema.Boolean }));
const decodeArgs = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeValues = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const decodeConfig = Schema.decodeUnknownResult(OpenbotMcpConfig);
const decodePatch = Schema.decodeUnknownResult(Schema.fromJsonString(OpenbotMcpPatch), {
  onExcessProperty: "error",
});

function botMcpRows(value: unknown) {
  const result = decodeMcp(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function botConnectionAgents(value: unknown) {
  const result = decodeAgents(value);
  return Result.isSuccess(result) ? result.success : null;
}

export function botMessagingOrchestrator(
  platform: BotMessagingPlatform,
  workspaceId: string,
  connections: readonly BotMessagingConnection[],
  agents: readonly BotConnectionAgent[],
): BotConnectionAgent | null {
  const candidates = connections.filter(
    (connection) =>
      connection.platform === platform &&
      (platform === "telegram" || connection.workspaceId === workspaceId),
  );
  for (const connection of candidates) {
    const agent = agents.find((entry) => entry.id === connection.orchestratorAgentId);
    if (agent) return agent;
  }
  return null;
}

export function botMessagingOrchestratorRequest(
  platform: BotMessagingPlatform,
  workspaceId: string,
) {
  const request = decodeOrchestratorRequest({
    operation: "connector.messaging.orchestrator",
    platform,
    workspaceId: platform === "telegram" ? null : workspaceId,
  });
  return Result.isSuccess(request) ? request.success : null;
}

export function botConnectionUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function botMessagingGrant(platform: "slack" | "discord", value: string, nonce: string) {
  try {
    const url = new URL(value.trim());
    const expected = platform === "slack" ? "slack-workspace" : "discord-guild";
    const grant = url.searchParams.get("grant");
    if (
      url.protocol !== "openbot:" ||
      url.hostname !== expected ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.searchParams.getAll("nonce").length !== 1 ||
      url.searchParams.getAll("grant").length !== 1 ||
      url.searchParams.get("nonce") !== nonce ||
      !grant ||
      grant.length > 16384
    )
      return null;
    return { operation: "connector.messaging.complete" as const, platform, nonce, grant };
  } catch {
    return null;
  }
}

export function botMcpPatchRequest(mcpServerId: string, value: string): OpenbotAdminRequest | null {
  const patch = decodePatch(value);
  return Result.isSuccess(patch)
    ? { operation: "mcp.updateById", mcpServerId, patch: patch.success }
    : null;
}

export interface BotMcpDraft {
  name: string;
  transport: "stdio" | "http";
  url: string;
  command: string;
  args: string;
  env: string;
  headers: string;
  workingDirectory: string;
}
export const EMPTY_BOT_MCP_DRAFT: BotMcpDraft = {
  name: "",
  transport: "http",
  url: "",
  command: "",
  args: "[]",
  env: "{}",
  headers: "{}",
  workingDirectory: "",
};
export function botMcpRequest(draft: BotMcpDraft): OpenbotAdminRequest | null {
  const args = decodeArgs(draft.args);
  const env = decodeValues(draft.env);
  const headers = decodeValues(draft.headers);
  if (
    !draft.name.trim() ||
    !Result.isSuccess(args) ||
    !Result.isSuccess(env) ||
    !Result.isSuccess(headers)
  )
    return null;
  try {
    const url = new URL(draft.url);
    if (
      draft.transport === "http" &&
      (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    )
      return null;
  } catch {
    if (draft.transport === "http") return null;
  }
  if (draft.transport === "stdio" && !draft.command.trim()) return null;
  const config = decodeConfig({
    id: "",
    name: draft.name.trim(),
    transport: draft.transport,
    enabled: true,
    command: draft.transport === "stdio" ? draft.command : "",
    args: draft.transport === "stdio" ? args.success : [],
    env:
      draft.transport === "stdio"
        ? Object.entries(env.success).map(([key, value]) => ({ key, value }))
        : [],
    envPassthrough: [],
    workingDirectory: draft.transport === "stdio" ? draft.workingDirectory : "",
    url: draft.transport === "http" ? draft.url : "",
    headers:
      draft.transport === "http"
        ? Object.entries(headers.success).map(([key, value]) => ({ key, value }))
        : [],
  });
  return Result.isSuccess(config) ? { operation: "mcp.save", config: config.success } : null;
}

export interface BotConnectionState {
  mcps: typeof McpRows.Type | null;
  signIns: typeof SignIns.Type | null;
  mcpStatus: typeof SignInStatus.Type | null;
  activeMcpId: string | null;
  github: typeof GitHub.Type | null;
  repositories: typeof Repositories.Type | null;
  messaging: Record<BotMessagingPlatform, typeof Messaging.Type | null>;
  page: { platform: BotMessagingPlatform; url: string | null; nonce: string | null } | null;
  skills: typeof Skills.Type | null;
  notice: string | null;
}
export const EMPTY_BOT_CONNECTIONS: BotConnectionState = {
  mcps: null,
  signIns: null,
  mcpStatus: null,
  activeMcpId: null,
  github: null,
  repositories: null,
  messaging: { slack: null, discord: null, telegram: null },
  page: null,
  skills: null,
  notice: null,
};

export function botConnectionResult(
  state: BotConnectionState,
  request: OpenbotAdminRequest,
  value: unknown,
): BotConnectionState | null {
  const next: BotConnectionState = { ...state, messaging: { ...state.messaging } };
  switch (request.operation) {
    case "mcp.list":
    case "mcp.save":
    case "mcp.updateById":
    case "mcp.delete":
    case "mcp.toggle": {
      next.mcps = botMcpRows(value);
      if (!next.mcps) return null;
      break;
    }
    case "mcp.signIn.list":
    case "mcp.signOut": {
      const result = decodeSignIns(value);
      if (!Result.isSuccess(result)) return null;
      next.signIns = result.success;
      break;
    }
    case "mcp.test":
    case "mcp.testById": {
      const result = decodeTest(value);
      if (!Result.isSuccess(result)) return null;
      next.notice = result.success.error ?? `Connected: ${result.success.toolCount} tools.`;
      break;
    }
    case "mcp.signIn.startById":
      next.activeMcpId = request.mcpServerId;
      next.mcpStatus = null;
      next.notice = "Sign-in opened in this host's private browser.";
      break;
    case "mcp.signIn.statusById": {
      const result = decodeSignIn(value);
      if (!Result.isSuccess(result)) return null;
      next.activeMcpId = result.success.result === null ? request.mcpServerId : null;
      next.mcpStatus = result.success;
      next.notice =
        result.success.result === null
          ? "Check the host's browser to complete any pending sign-in."
          : (result.success.result.error ??
            `Sign-in finished: ${result.success.result.toolCount} tools.`);
      break;
    }
    case "mcp.signIn.cancelById":
      next.activeMcpId = null;
      next.mcpStatus = null;
      next.notice = "Sign-in cancelled.";
      break;
    case "connector.github.status":
    case "connector.github.connect":
    case "connector.github.cancel":
    case "connector.github.disconnect": {
      const result = decodeGitHub(value);
      if (!Result.isSuccess(result)) return null;
      if (result.success.state !== "connected" || result.success.login !== state.github?.login)
        next.repositories = null;
      next.github = result.success;
      break;
    }
    case "connector.github.repositories": {
      const result = decodeRepositories(value);
      if (!Result.isSuccess(result)) return null;
      next.repositories = result.success;
      break;
    }
    case "connector.messaging.overview": {
      const result = decodeMessaging(value);
      if (
        !Result.isSuccess(result) ||
        result.success.connections.some((entry) => entry.platform !== request.platform)
      )
        return null;
      next.messaging[request.platform] = result.success;
      break;
    }
    case "connector.messaging.connect":
    case "connector.messaging.reconnect": {
      const result = decodePage(value);
      if (!Result.isSuccess(result)) return null;
      if (result.success.url !== null && botConnectionUrl(result.success.url) === null) return null;
      next.page = { platform: request.platform, ...result.success };
      break;
    }
    case "connector.messaging.complete": {
      const result = decodeAccepted(value);
      if (!Result.isSuccess(result) || !result.success.accepted) return null;
      next.page = null;
      next.notice = "Connection completed.";
      break;
    }
    case "connector.messaging.orchestrator": {
      const result = decodeOrchestrator(value);
      if (!Result.isSuccess(result)) return null;
      next.notice = `Orchestrator ready: ${result.success.agentId}.`;
      break;
    }
    case "skill.list": {
      const result = decodeSkills(value);
      if (!Result.isSuccess(result)) return null;
      next.skills = result.success;
      break;
    }
    case "skill.install":
    case "skill.toggle": {
      const result = decodeSkill(value);
      if (!Result.isSuccess(result)) return null;
      next.notice = `${result.success.name} updated.`;
      break;
    }
    case "skill.uninstall":
      next.notice = "Skill removed.";
      break;
    case "connector.messaging.disconnect":
    case "connector.messaging.enabled":
      next.notice = "Connection updated.";
      break;
    default:
      return null;
  }
  return next;
}

export type BotConnectionExecute = (
  request: OpenbotAdminRequest,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
