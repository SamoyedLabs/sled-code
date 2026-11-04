import { OpenbotRoutineSchedule as ChannelRoutineSchedule } from "./openbotEvents.ts";
import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));
const Text = Schema.String.check(Schema.isMaxLength(100_000));
const Status = Schema.Literals(["streaming", "completed", "failed", "interrupted"]);
const Member = Schema.Struct({ agentId: Id });
export const OpenbotChannelDraft = Schema.Struct({
  name: Name,
  title: Schema.String.check(Schema.isMaxLength(120)),
  instructions: Schema.String.check(Schema.isMaxLength(2_000)),
  members: Schema.Array(Member).check(Schema.isMaxLength(100)),
  leadAgentId: Schema.NullOr(Id),
}).check(
  Schema.makeFilter(
    (draft) =>
      draft.name.trim().length > 0 &&
      new Set(draft.members.map((member) => member.agentId)).size === draft.members.length &&
      (draft.leadAgentId === null ||
        draft.members.some((member) => member.agentId === draft.leadAgentId)),
  ),
);
export type OpenbotChannelDraft = typeof OpenbotChannelDraft.Type;
export const OpenbotChannel = Schema.Struct({
  ...OpenbotChannelDraft.fields,
  id: Id,
  archived: Schema.Boolean,
  revision: Count,
  createdAt: Schema.String.check(Schema.isMaxLength(80)),
});
export type OpenbotChannel = typeof OpenbotChannel.Type;
const PreviewAuthor = Schema.Struct({
  kind: Schema.Literals(["member", "agent", "coordinator"]),
  id: Id,
});
export const OpenbotChannelSummary = Schema.Struct({
  ...OpenbotChannel.fields,
  unreadCount: Count,
  activeTasks: Count,
  openTasks: Schema.optional(Count),
  threads: Schema.optional(
    Schema.Array(Schema.Struct({ agentId: Id, threadId: Id })).check(Schema.isMaxLength(100)),
  ),
  lastMessage: Schema.NullOr(
    Schema.Struct({
      authorName: Schema.String.check(Schema.isMaxLength(120)),
      text: Schema.String.check(Schema.isMaxLength(200)),
      at: Schema.String.check(Schema.isMaxLength(80)),
      author: Schema.optional(PreviewAuthor),
      status: Schema.optional(Status),
    }),
  ),
});
export type OpenbotChannelSummary = typeof OpenbotChannelSummary.Type;
export const OpenbotChannelTask = Schema.Struct({
  id: Id,
  channelId: Id,
  parentTaskId: Schema.NullOr(Id),
  rootTaskId: Id,
  ownerAgentId: Schema.NullOr(Id),
  requestMessageId: Id,
  instruction: Text,
  expectedResult: Text,
  attachmentDraftIds: Schema.Array(Id).check(Schema.isMaxLength(100)),
  sourceMessageIds: Schema.Array(Id).check(Schema.isMaxLength(100)),
  dependencies: Schema.Array(Id).check(Schema.isMaxLength(100)),
  resources: Schema.Array(Schema.String.check(Schema.isMaxLength(4_096))).check(
    Schema.isMaxLength(64),
  ),
  state: Schema.Literals([
    "queued",
    "running",
    "waiting",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]),
  revision: Count,
  assignmentCount: Count,
  error: Schema.NullOr(Text),
});
export type OpenbotChannelTask = typeof OpenbotChannelTask.Type;
const Attachment = Schema.Struct({
  id: Id,
  name: Schema.String.check(Schema.isMaxLength(255)),
  size: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  kind: Schema.Literals(["image", "file"]),
  mimeType: Schema.String.check(Schema.isMaxLength(255)),
  previewKind: Schema.Literals(["image", "pdf", "text", "none"]),
  previewUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
});
export const OpenbotChannelMessage = Schema.Struct({
  id: Id,
  channelId: Id,
  sequence: Count,
  author: Schema.Struct({
    ...PreviewAuthor.fields,
    name: Schema.String.check(Schema.isMaxLength(120)),
  }),
  taskId: Schema.NullOr(Id),
  superseded: Schema.Boolean,
  message: Schema.Struct({
    id: Id,
    author: Schema.Literals(["user", "assistant", "agent", "system"]),
    text: Schema.String,
    createdAt: Schema.String.check(Schema.isMaxLength(160)),
    status: Status,
    turnId: Schema.optional(Id),
    itemType: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
    source: Schema.optional(Schema.Literals(["user", "assistant", "agent", "system", "routine"])),
    replyToMessageId: Schema.optional(Schema.NullOr(Id)),
    attachments: Schema.optional(Schema.Array(Attachment).check(Schema.isMaxLength(100))),
    imageGeneration: Schema.optional(Schema.Json),
    questionPrompt: Schema.optional(Schema.Json),
    uiBlock: Schema.optional(Schema.Json),
  }),
});
export type OpenbotChannelMessage = typeof OpenbotChannelMessage.Type;
export const OpenbotChannelPage = Schema.Struct({
  channel: OpenbotChannel,
  messages: Schema.Array(OpenbotChannelMessage).check(Schema.isMaxLength(100)),
  tasks: Schema.Array(OpenbotChannelTask),
  olderCursor: Schema.NullOr(Count),
  throughSequence: Count,
});
export type OpenbotChannelPage = typeof OpenbotChannelPage.Type;
const DateText = Schema.String.check(Schema.isMaxLength(80));
export const OpenbotChannelMemory = Schema.Struct({
  id: Id,
  channelId: Id,
  text: Schema.String.check(Schema.isMaxLength(500)),
  origin: Schema.Literals(["automatic", "manual"]),
  sourceTurnId: Schema.NullOr(Id),
  createdAt: DateText,
  updatedAt: DateText,
});
export type OpenbotChannelMemory = typeof OpenbotChannelMemory.Type;
const RoutineDraft = {
  name: Name,
  instruction: Text,
  active: Schema.Boolean,
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  schedule: ChannelRoutineSchedule,
};
export const OpenbotChannelRoutine = Schema.Struct({
  id: Id,
  channelId: Id,
  name: Name,
  instruction: Text,
  active: Schema.Boolean,
  timezone: RoutineDraft.timezone,
  trigger: Schema.Struct({
    id: Id,
    routineId: Id,
    schedule: ChannelRoutineSchedule,
    nextRunAt: DateText,
    createdAt: DateText,
    updatedAt: DateText,
  }),
  createdAt: DateText,
  updatedAt: DateText,
});
export type OpenbotChannelRoutine = typeof OpenbotChannelRoutine.Type;
export const OpenbotChannelRoutineRun = Schema.Struct({
  id: Id,
  channelId: Id,
  routineId: Id,
  triggerId: Schema.NullOr(Id),
  kind: Schema.Literals(["scheduled", "manual"]),
  scheduledFor: DateText,
  routineName: Name,
  instruction: Text,
  requestMessageId: Schema.NullOr(Id),
  status: Schema.Literals([
    "queued",
    "running",
    "needs-attention",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  error: Schema.NullOr(Text),
  createdAt: DateText,
  updatedAt: DateText,
});
export type OpenbotChannelRoutineRun = typeof OpenbotChannelRoutineRun.Type;
export const OpenbotChannelReadRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literals(["channel.memories", "channel.routines"]),
    channelId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.routine.runs"),
    channelId: Id,
    routineId: Id,
    limit: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  }),
  Schema.Struct({ operation: Schema.Literal("channel.list") }),
  Schema.Struct({
    operation: Schema.Literal("channel.read"),
    channelId: Id,
    beforeSequence: Schema.optional(Schema.NullOr(Count)),
  }),
]);
export type OpenbotChannelReadRequest = typeof OpenbotChannelReadRequest.Type;
const Command = { channelId: Id, operationId: Id };
export const OpenbotChannelAdminRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("channel.memory.create"),
    channelId: Id,
    text: OpenbotChannelMemory.fields.text,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.memory.update"),
    channelId: Id,
    memoryId: Id,
    text: OpenbotChannelMemory.fields.text,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.memory.delete"),
    channelId: Id,
    memoryId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("channel.memory.clear"), channelId: Id }),
  Schema.Struct({
    operation: Schema.Literal("channel.routine.create"),
    channelId: Id,
    ...RoutineDraft,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.routine.update"),
    channelId: Id,
    routineId: Id,
    name: Schema.optional(Name),
    instruction: Schema.optional(Text),
    active: Schema.optional(Schema.Boolean),
    schedule: Schema.optional(ChannelRoutineSchedule),
  }).check(
    Schema.makeFilter(
      (value) =>
        value.name !== undefined ||
        value.instruction !== undefined ||
        value.active !== undefined ||
        value.schedule !== undefined,
    ),
  ),
  Schema.Struct({
    operation: Schema.Literals(["channel.routine.delete", "channel.routine.test"]),
    channelId: Id,
    routineId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.save"),
    ...Command,
    draft: OpenbotChannelDraft,
    update: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literals(["channel.archive", "channel.restore"]), ...Command }),
  Schema.Struct({
    operation: Schema.Literal("channel.markRead"),
    ...Command,
    throughSequence: Count,
  }),
  Schema.Struct({
    operation: Schema.Literal("channel.send"),
    ...Command,
    text: Text,
    recipientAgentId: Schema.NullOr(Id),
    replyToMessageId: Schema.NullOr(Id),
    attachmentDraftIds: Schema.Array(Id).check(Schema.isMaxLength(100)),
  }).check(
    Schema.makeFilter(
      (request) => request.text.trim().length > 0 || request.attachmentDraftIds.length > 0,
    ),
  ),
  Schema.Struct({
    operation: Schema.Literals([
      "channel.stop",
      "channel.resume",
      "channel.reassign",
      "channel.cancel",
    ]),
    ...Command,
    taskId: Id,
    recipientAgentId: Schema.NullOr(Id),
  }),
  Schema.Struct({ operation: Schema.Literal("channel.delete"), channelId: Id }),
]);
export type OpenbotChannelAdminRequest = typeof OpenbotChannelAdminRequest.Type;
