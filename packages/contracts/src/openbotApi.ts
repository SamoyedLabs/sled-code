import { OpenbotRoutineSchedule, OpenbotEventAdminRequest } from "./openbotEvents.ts";
export { OpenbotRoutineSchedule } from "./openbotEvents.ts";
import { OpenbotRoutineFlowReadRequest, OpenbotRoutineFlowCommand } from "./openbotRoutineFlows.ts";
import {
  OpenbotConversationReadRequest,
  OpenbotConversationCommand,
  OpenbotQueueCommand,
} from "./openbotConversation.ts";
import { OpenbotBrowserReadRequest, OpenbotBrowserAdminRequest } from "./openbotBrowser.ts";
import * as Schema from "effect/Schema";
import { OpenbotChannelReadRequest, OpenbotChannelAdminRequest } from "./openbotChannels.ts";
import { OpenbotWorkflowReadRequest, OpenbotWorkflowAdminRequest } from "./openbotWorkflows.ts";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/));
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000));
const Model = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(160),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]*$/),
);
const ProviderId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const AccountId = Schema.String.check(Schema.isPattern(/^(?:default|a[0-9a-f]{16})$/));
const ReasoningEffort = Schema.Literals([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const Timezone = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));
const Description = Schema.String.check(Schema.isMaxLength(2_000));
const MemoryText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const RoutineInput = Schema.Struct({
  name: Name,
  instruction: Text,
  active: Schema.Boolean,
  timezone: Timezone,
  schedule: OpenbotRoutineSchedule,
});
const RoutinePatch = Schema.Struct({
  name: Schema.optional(Name),
  instruction: Schema.optional(Text),
  active: Schema.optional(Schema.Boolean),
  schedule: Schema.optional(OpenbotRoutineSchedule),
});

const RequestId = Schema.Union([
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  Schema.Int,
]);
const ShortUrl = Schema.String.check(Schema.isMaxLength(2_048));
const Pair = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(255)),
  value: Schema.String.check(Schema.isMaxLength(8_192)),
});
export const OpenbotMcpConfig = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(128)),
  name: Schema.String.check(Schema.isMaxLength(80)),
  transport: Schema.Literals(["stdio", "http"]),
  enabled: Schema.Boolean,
  command: Schema.String.check(Schema.isMaxLength(4_096)),
  args: Schema.Array(Schema.String.check(Schema.isMaxLength(4_096))).check(Schema.isMaxLength(64)),
  env: Schema.Array(Pair).check(Schema.isMaxLength(64)),
  envPassthrough: Schema.Array(Schema.String.check(Schema.isMaxLength(255))).check(
    Schema.isMaxLength(64),
  ),
  workingDirectory: Schema.String.check(Schema.isMaxLength(4_096)),
  url: ShortUrl,
  headers: Schema.Array(Pair).check(Schema.isMaxLength(32)),
});
export const OpenbotMcpPatch = Schema.Struct({
  name: Schema.optional(OpenbotMcpConfig.fields.name),
  transport: Schema.optional(OpenbotMcpConfig.fields.transport),
  enabled: Schema.optional(OpenbotMcpConfig.fields.enabled),
  command: Schema.optional(OpenbotMcpConfig.fields.command),
  args: Schema.optional(OpenbotMcpConfig.fields.args),
  env: Schema.optional(OpenbotMcpConfig.fields.env),
  envPassthrough: Schema.optional(OpenbotMcpConfig.fields.envPassthrough),
  workingDirectory: Schema.optional(OpenbotMcpConfig.fields.workingDirectory),
  url: Schema.optional(OpenbotMcpConfig.fields.url),
  headers: Schema.optional(OpenbotMcpConfig.fields.headers),
});
const PromptAnswers = Schema.Record(
  Schema.String.check(Schema.isMaxLength(512)),
  Schema.Array(Schema.String.check(Schema.isMaxLength(100_000))).check(Schema.isMaxLength(32)),
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.values(value).reduce(
        (total, answers) => total + answers.reduce((sum, text) => sum + text.length, 0),
        0,
      ) <= 100_000,
  ),
);
const Platform = Schema.Literals(["slack", "discord", "telegram"]);
const MessagingPlaceId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
export const OpenbotMessagingOrchestratorRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.orchestrator"),
    platform: Schema.Literals(["slack", "discord"]),
    workspaceId: MessagingPlaceId,
  }),
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.orchestrator"),
    platform: Schema.Literal("telegram"),
    workspaceId: Schema.Null,
  }),
]);

export const OpenbotReadRequest = Schema.Union([
  OpenbotRoutineFlowReadRequest,
  OpenbotConversationReadRequest,
  OpenbotWorkflowReadRequest,
  Schema.Struct({ operation: Schema.Literal("compatibility.read") }),
  OpenbotChannelReadRequest,

  Schema.Struct({ operation: Schema.Literal("agent.list") }),
  Schema.Struct({ operation: Schema.Literal("agent.models") }),
  Schema.Struct({ operation: Schema.Literal("provider.modelVisibility.listing") }),
  Schema.Struct({ operation: Schema.Literal("agent.status") }),
  Schema.Struct({ operation: Schema.Literal("conversation.read"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("task.list"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("task.read"), agentId: Id, taskId: Id }),
  Schema.Struct({ operation: Schema.Literal("memory.list"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("routine.list"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("routine.runs"), agentId: Id, routineId: Id }),
  Schema.Struct({ operation: Schema.Literal("queue.read"), agentId: Id }),
]);
export type OpenbotReadRequest = typeof OpenbotReadRequest.Type;

export const OpenbotWriteRequest = Schema.Union([
  OpenbotRoutineFlowCommand,
  OpenbotConversationCommand,
  OpenbotQueueCommand,
  Schema.Struct({
    operation: Schema.Literal("conversation.send"),
    replyToMessageId: Schema.optional(Schema.NullOr(Id)),
    attachmentDraftIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(10))),
    agentId: Id,
    text: Text,
    clientMessageId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("conversation.stop"), agentId: Id, turnId: Id }),
  Schema.Struct({
    operation: Schema.Literal("task.start"),
    agentId: Id,
    text: Text,
    clientMessageId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("task.send"),
    agentId: Id,
    taskId: Id,
    text: Text,
    clientMessageId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literals(["task.stop", "task.close", "task.reopen"]),
    agentId: Id,
    taskId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("routine.test"), agentId: Id, routineId: Id }),
]);
export type OpenbotWriteRequest = typeof OpenbotWriteRequest.Type;

export const OpenbotHostWriteInput = Schema.Struct({
  hostId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  request: OpenbotWriteRequest,
});
export type OpenbotHostWriteInput = typeof OpenbotHostWriteInput.Type;

const AttentionResponse = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("approval.respond"),
    requestId: RequestId,
    decision: Schema.Literals(["accept", "decline"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("prompt.respond"),
    requestId: RequestId,
    answers: PromptAnswers,
  }),
  Schema.Struct({
    operation: Schema.Literal("takeover.respond"),
    requestId: RequestId,
    decision: Schema.Literals(["complete", "cancel"]),
  }),
]);
export const OpenbotAttentionResponseInput = Schema.Struct({
  hostId: Id,
  request: AttentionResponse,
});
export type OpenbotAttentionResponseInput = typeof OpenbotAttentionResponseInput.Type;

export const OpenbotAdminRequest = Schema.Union([
  OpenbotEventAdminRequest,
  OpenbotWriteRequest,
  OpenbotBrowserReadRequest,
  OpenbotBrowserAdminRequest,
  OpenbotChannelAdminRequest,
  OpenbotWorkflowAdminRequest,
  Schema.Struct({
    operation: Schema.Literal("provider.signInRelay.start"),
    provider: Schema.Literals(["codex", "claude", "antigravity", "muse"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.account.signInRelay.start"),
    provider: Schema.Literals(["codex", "claude", "antigravity"]),
    accountId: Schema.NullOr(AccountId),
  }),
  Schema.Struct({
    operation: Schema.Literals(["provider.signInRelay.status", "provider.signInRelay.cancel"]),
    flowId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.signInRelay.complete"),
    flowId: Id,
    query: Schema.String.check(Schema.isMaxLength(8192)),
  }),
  Schema.Struct({
    operation: Schema.Literals(["provider.accounts.list", "provider.accounts.usage"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.account.signIn.start"),
    provider: ProviderId,
    accountId: Schema.NullOr(AccountId),
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "provider.account.signIn.status",
      "provider.account.signIn.cancel",
    ]),
    provider: ProviderId,
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.account.rename"),
    provider: ProviderId,
    accountId: AccountId,
    label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(60))),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.account.remove"),
    provider: ProviderId,
    accountId: AccountId,
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.account.assign"),
    agentId: Id,
    accountId: Schema.NullOr(AccountId),
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "provider.codeLogin.start",
      "provider.codeLogin.cancel",
      "provider.apiKey.state",
      "provider.apiKey.clear",
      "provider.runtimes.download",
      "provider.runtimes.cancel",
      "provider.signOut",
    ]),
    provider: ProviderId,
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.codeLogin.submit"),
    provider: ProviderId,
    code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.apiKey.set"),
    provider: ProviderId,
    key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "provider.runtimes.status",
      "provider.runtimes.check",
      "provider.default.read",
      "provider.custom.list",
      "provider.customAgent.list",
    ]),
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "provider.hostSignIn.start",
      "provider.hostSignIn.status",
      "provider.hostSignIn.cancel",
    ]),
    provider: Schema.Literal("antigravity"),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.default.update"),
    provider: ProviderId,
    model: Schema.NullOr(Model),
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.custom.save"),
    input: Schema.Struct({
      id: Id,
      name: Name,
      baseUrl: ShortUrl,
      apiKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
      models: Schema.Array(
        Schema.Struct({ id: Model, name: Schema.String.check(Schema.isMaxLength(160)) }),
      ).check(Schema.isMaxLength(64)),
      headers: Schema.Array(
        Schema.Struct({
          name: Schema.String.check(Schema.isMaxLength(128)),
          value: Schema.String.check(Schema.isMaxLength(4096)),
        }),
      ).check(Schema.isMaxLength(32)),
    }),
  }),
  Schema.Struct({ operation: Schema.Literal("provider.custom.delete"), id: Id }),
  Schema.Struct({
    operation: Schema.Literal("provider.customAgent.save"),
    input: Schema.Struct({
      id: Id,
      name: Name,
      command: Schema.String.check(Schema.isMaxLength(1024)),
      args: Schema.Array(Schema.String.check(Schema.isMaxLength(1024))).check(
        Schema.isMaxLength(32),
      ),
      env: Schema.Array(
        Schema.Struct({
          name: Schema.String.check(Schema.isMaxLength(128)),
          value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
        }),
      ).check(Schema.isMaxLength(16)),
      usagePrompt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
    }),
  }),
  Schema.Struct({ operation: Schema.Literal("provider.customAgent.delete"), id: Id }),
  Schema.Struct({
    operation: Schema.Literal("provider.modelVisibility.read"),
    provider: ProviderId,
  }),
  Schema.Struct({
    operation: Schema.Literal("provider.modelVisibility.update"),
    provider: ProviderId,
    shown: Schema.NullOr(Schema.Array(Model).check(Schema.isMaxLength(10000))),
  }),
  AttentionResponse,
  Schema.Struct({ operation: Schema.Literal("agent.permissions.read"), agentId: Id }),
  Schema.Struct({
    operation: Schema.Literal("agent.permissions.update"),
    agentId: Id,
    access: Schema.optional(Schema.Literals(["full", "workspace"])),
    autoApprove: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ operation: Schema.Literal("agent.instructions.read"), agentId: Id }),
  Schema.Struct({
    operation: Schema.Literal("agent.instructions.save"),
    agentId: Id,
    text: Schema.String.check(Schema.isMaxLength(32_000)),
    expected: Schema.String.check(Schema.isMaxLength(256_000)),
  }),
  Schema.Struct({ operation: Schema.Literal("browser.tabs") }),
  Schema.Struct({ operation: Schema.Literal("browser.control") }),
  Schema.Struct({ operation: Schema.Literal("browser.held") }),
  Schema.Struct({
    operation: Schema.Literal("browser.open"),
    url: ShortUrl,
    focus: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "browser.activate",
      "browser.reload",
      "browser.close",
      "browser.take",
      "browser.release",
      "browser.preview",
    ]),
    tabId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("browser.load"), tabId: Id, url: ShortUrl }),
  Schema.Struct({
    operation: Schema.Literal("browser.navigate"),
    tabId: Id,
    direction: Schema.Literals(["back", "forward"]),
  }),
  Schema.Struct({ operation: Schema.Literal("skill.list"), agentId: Id }),
  Schema.Struct({
    operation: Schema.Literal("skill.install"),
    agentId: Id,
    skillId: Id,
    versionId: Schema.optional(Id),
    replaceModified: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    operation: Schema.Literal("skill.uninstall"),
    agentId: Id,
    skillId: Id,
    removeModified: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    operation: Schema.Literal("skill.toggle"),
    agentId: Id,
    skillId: Id,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literal("mcp.list") }),
  Schema.Struct({
    operation: Schema.Literal("mcp.updateById"),
    mcpServerId: Id,
    patch: OpenbotMcpPatch,
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "mcp.testById",
      "mcp.signIn.startById",
      "mcp.signIn.statusById",
      "mcp.signIn.cancelById",
    ]),
    mcpServerId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literals(["mcp.save", "mcp.test", "mcp.signIn.start"]),
    config: OpenbotMcpConfig,
  }),
  Schema.Struct({ operation: Schema.Literals(["mcp.delete", "mcp.signOut"]), mcpServerId: Id }),
  Schema.Struct({
    operation: Schema.Literal("mcp.toggle"),
    mcpServerId: Id,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literals(["mcp.signIn.status", "mcp.signIn.cancel"]),
    url: ShortUrl,
  }),
  Schema.Struct({ operation: Schema.Literal("mcp.signIn.list") }),
  Schema.Struct({
    operation: Schema.Literals([
      "connector.github.status",
      "connector.github.connect",
      "connector.github.cancel",
      "connector.github.disconnect",
      "connector.github.repositories",
    ]),
  }),
  Schema.Struct({ operation: Schema.Literal("connector.messaging.overview"), platform: Platform }),
  OpenbotMessagingOrchestratorRequest,
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.connect"),
    platform: Platform,
    place: Schema.Literals(["direct", "group"]),
  }),
  Schema.Struct({
    operation: Schema.Literals(["connector.messaging.disconnect", "connector.messaging.reconnect"]),
    platform: Platform,
    workspaceId: MessagingPlaceId,
  }),
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.enabled"),
    platform: Platform,
    workspaceId: MessagingPlaceId,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.complete"),
    platform: Schema.Literals(["slack", "discord"]),
    nonce: Id,
    grant: Schema.String.check(Schema.isMaxLength(16_384)),
  }),

  Schema.Struct({
    operation: Schema.Literal("agent.create"),
    input: Schema.Struct({
      name: Name,
      description: Description,
      initialMessage: Text,
      provider: Schema.optional(ProviderId),
      model: Schema.optional(Model),
      reasoningEffort: Schema.optional(ReasoningEffort),
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("agent.update"),
    agentId: Id,
    input: Schema.Struct({
      name: Schema.optional(Name),
      title: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
      description: Schema.optional(Description),
      notifications: Schema.optional(Schema.Boolean),
      provider: Schema.optional(ProviderId),
      model: Schema.optional(Model),
      reasoningEffort: Schema.optional(ReasoningEffort),
    }),
  }),
  Schema.Struct({ operation: Schema.Literal("agent.delete"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("memory.create"), agentId: Id, text: MemoryText }),
  Schema.Struct({
    operation: Schema.Literal("memory.update"),
    agentId: Id,
    memoryId: Id,
    text: MemoryText,
  }),
  Schema.Struct({ operation: Schema.Literal("memory.delete"), agentId: Id, memoryId: Id }),
  Schema.Struct({ operation: Schema.Literal("routine.create"), agentId: Id, input: RoutineInput }),
  Schema.Struct({
    operation: Schema.Literal("routine.update"),
    agentId: Id,
    routineId: Id,
    input: RoutinePatch,
  }),
  Schema.Struct({ operation: Schema.Literal("routine.delete"), agentId: Id, routineId: Id }),
]);
export type OpenbotAdminRequest = typeof OpenbotAdminRequest.Type;

// Results retain released JSON shapes; provider and MCP replies are projected server-side.
export const OpenbotApiResponse = Schema.Json;
