import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/));
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000));
const Model = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Timezone = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Timestamp = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));
const Description = Schema.String.check(Schema.isMaxLength(2_000));
const MemoryText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const Time = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
const Positive = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(100_000),
);
const Weekday = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6));
const MonthDay = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(31));
const Month = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(12));
const Unit = Schema.Literals(["minutes", "hours", "days"]);
const Days = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("every-day") }),
  Schema.Struct({
    kind: Schema.Literal("days-of-week"),
    days: Schema.Array(Weekday).check(Schema.isMinLength(1), Schema.isMaxLength(7)),
  }),
  Schema.Struct({
    kind: Schema.Literal("days-of-month"),
    days: Schema.Array(MonthDay).check(Schema.isMinLength(1), Schema.isMaxLength(31)),
  }),
]);
export const OpenbotRoutineSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("hourly"),
    minute: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(59)),
  }),
  Schema.Struct({ kind: Schema.Literals(["daily", "weekdays"]), time: Time }),
  Schema.Struct({ kind: Schema.Literal("weekly"), weekday: Weekday, time: Time }),
  Schema.Struct({ kind: Schema.Literal("monthly"), day: MonthDay, time: Time }),
  Schema.Struct({
    kind: Schema.Literal("interval"),
    amount: Positive,
    unit: Unit,
    anchorAt: Timestamp,
  }),
  Schema.Struct({
    kind: Schema.Literal("custom"),
    expression: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  }),
  Schema.Struct({
    kind: Schema.Literal("advanced"),
    months: Schema.Array(Month).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    days: Days,
    time: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("at-time"), time: Time }),
      Schema.Struct({
        kind: Schema.Literal("every"),
        amount: Positive,
        unit: Schema.Literals(["minutes", "hours"]),
      }),
    ]),
  }),
]);
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

export const OpenbotReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("compatibility.read") }),
  Schema.Struct({ operation: Schema.Literal("channel.list") }),
  Schema.Struct({
    operation: Schema.Literal("channel.read"),
    channelId: Id,
    beforeSequence: Schema.optional(
      Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    ),
  }),

  Schema.Struct({ operation: Schema.Literal("agent.list") }),
  Schema.Struct({ operation: Schema.Literal("agent.models") }),
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
  Schema.Struct({
    operation: Schema.Literal("conversation.send"),
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
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.connect"),
    platform: Platform,
    place: Schema.Literals(["direct", "group"]),
  }),
  Schema.Struct({
    operation: Schema.Literals(["connector.messaging.disconnect", "connector.messaging.reconnect"]),
    platform: Platform,
    workspaceId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("connector.messaging.enabled"),
    platform: Platform,
    workspaceId: Id,
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
      provider: Schema.optional(Id),
      model: Schema.optional(Model),
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
      provider: Schema.optional(Id),
      model: Schema.optional(Model),
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

// Results retain the released upstream JSON shape; routes cannot reach auth, secrets or host administration.
export const OpenbotApiResponse = Schema.Json;
