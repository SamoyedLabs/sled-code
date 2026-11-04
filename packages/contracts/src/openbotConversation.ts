import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Text = Schema.String.check(Schema.isMaxLength(100_000));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(10));
export const OpenbotConversationMessage = Schema.StructWithRest(
  Schema.Struct({
    id: Id,
    author: Schema.Literals(["user", "assistant", "agent", "system"]),
    text: Text,
    status: Schema.Literals(["streaming", "completed", "failed", "interrupted"]),
    createdAt: Schema.String.check(Schema.isMaxLength(160)),
    turnId: Schema.optional(Id),
    itemType: Schema.optional(Schema.String),
    replyToMessageId: Schema.optional(Schema.NullOr(Id)),
    senderMember: Schema.optional(Schema.Struct({ id: Id, name: Schema.String })),
    senderAgentId: Schema.optional(Id),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
export type OpenbotConversationMessage = typeof OpenbotConversationMessage.Type;
export const OpenbotConversationReadState = Schema.Struct({
  unreadCount: Count,
  firstUnreadMessageId: Schema.NullOr(Id),
  throughMessageId: Schema.NullOr(Id),
});
export const OpenbotConversationSnapshot = Schema.Struct({
  agentId: Id,
  threadId: Schema.NullOr(Id),
  activeTurnId: Schema.NullOr(Id),
  revision: Count,
  messages: Schema.Array(OpenbotConversationMessage).check(Schema.isMaxLength(500)),
  readState: Schema.optional(OpenbotConversationReadState),
});
export const OpenbotConversationPage = Schema.Struct({
  ...OpenbotConversationSnapshot.fields,
  references: Schema.Record(Id, OpenbotConversationMessage),
  pageInfo: Schema.Struct({
    hasOlder: Schema.Boolean,
    olderCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  }),
});
export type OpenbotConversationPage = typeof OpenbotConversationPage.Type;
export const OpenbotConversationReadRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("conversation.page"),
    agentId: Id,
    anchor: Schema.Union([
      Schema.Struct({ type: Schema.Literal("latest") }),
      Schema.Struct({
        type: Schema.Literal("before"),
        cursor: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
      }),
      Schema.Struct({ type: Schema.Literal("around"), messageId: Id }),
    ]),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  }),
  Schema.Struct({ operation: Schema.Literals(["thread.reads", "thread.branches"]), agentId: Id }),
]);
export type OpenbotConversationReadRequest = typeof OpenbotConversationReadRequest.Type;
export const OpenbotConversationCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("conversation.markRead"),
    agentId: Id,
    throughMessageId: Schema.NullOr(Id),
  }),
  Schema.Struct({ operation: Schema.Literal("conversation.markUnread"), agentId: Id }),
  Schema.Struct({
    operation: Schema.Literal("conversation.react"),
    agentId: Id,
    messageId: Id,
    emoji: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
  }),
  Schema.Struct({
    operation: Schema.Literal("thread.markRead"),
    agentId: Id,
    taskId: Id,
    throughMessageId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread.rename"),
    agentId: Id,
    taskId: Id,
    title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  }),
  Schema.Struct({ operation: Schema.Literal("thread.delete"), agentId: Id, taskId: Id }),
  Schema.Struct({
    operation: Schema.Literal("thread.branch"),
    agentId: Id,
    taskId: Schema.NullOr(Id),
    messageId: Id,
    requestId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("thread.reply"),
    agentId: Id,
    taskId: Id,
    text: Text,
    attachmentDraftIds: Ids,
    replyToMessageId: Id,
    clientMessageId: Id,
  }),
]);
export type OpenbotConversationCommand = typeof OpenbotConversationCommand.Type;
export const OpenbotQueueDelivery = Schema.Struct({
  id: Id,
  messageId: Id,
  recipientAgentId: Id,
  sender: Schema.Json,
  text: Text,
  attachments: Schema.Array(Schema.Json).check(Schema.isMaxLength(10)),
  replyToMessageId: Schema.NullOr(Id),
  status: Schema.Literals([
    "queued",
    "starting",
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
  ]),
  position: Schema.NullOr(Count),
  turnId: Schema.NullOr(Id),
  error: Schema.NullOr(Text),
  createdAt: Schema.String,
  editing: Schema.optional(Schema.Boolean),
  expectsReply: Schema.optional(Schema.Boolean),
});
export type OpenbotQueueDelivery = typeof OpenbotQueueDelivery.Type;
export const OpenbotQueueSnapshot = Schema.Struct({
  agentId: Id,
  deliveries: Schema.Array(OpenbotQueueDelivery).check(Schema.isMaxLength(2000)),
  hold: Schema.optional(Schema.NullOr(Schema.Json)),
});
export type OpenbotQueueSnapshot = typeof OpenbotQueueSnapshot.Type;
const Edit = { operation: Schema.Literal("queue.edit"), agentId: Id, deliveryId: Id, editId: Id };
export const OpenbotQueueCommand = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("queue.cancel"), agentId: Id, deliveryId: Id }),
  Schema.Struct({
    operation: Schema.Literal("queue.steer"),
    agentId: Id,
    deliveryId: Id,
    expectedTurnId: Id,
  }),
  Schema.Struct({ operation: Schema.Literal("queue.acknowledgeFailure"), agentId: Id, turnId: Id }),
  Schema.Struct({
    operation: Schema.Literal("queue.reorder"),
    agentId: Id,
    deliveryIds: Schema.Array(Id).check(
      Schema.isMaxLength(100),
      Schema.makeFilter((ids) => new Set(ids).size === ids.length),
    ),
  }),
  Schema.Struct({ ...Edit, action: Schema.Literals(["begin", "cancel"]) }),
  Schema.Struct({ ...Edit, action: Schema.Literal("retain-attachments"), attachmentDraftIds: Ids }),
  Schema.Struct({
    ...Edit,
    action: Schema.Literal("save"),
    text: Text,
    keepAttachmentIds: Ids,
    attachmentDraftIds: Ids,
  }).check(
    Schema.makeFilter(
      (input) => input.keepAttachmentIds.length + input.attachmentDraftIds.length <= 10,
    ),
  ),
]);
export type OpenbotQueueCommand = typeof OpenbotQueueCommand.Type;

export const OpenbotThreadReadState = Schema.Struct({
  taskId: Id,
  ...OpenbotConversationReadState.fields,
});
export const OpenbotThreadBranchLink = Schema.Struct({
  sourceTaskId: Schema.NullOr(Id),
  sourceTitle: Schema.NullOr(Schema.String.check(Schema.isMaxLength(120))),
  sourceMessageId: Id,
  throughMessageId: Id,
});
export const OpenbotThreadBranchResult = Schema.StructWithRest(
  Schema.Struct({ id: Id, branch: OpenbotThreadBranchLink }),
  [Schema.Record(Schema.String, Schema.Json)],
);
export const OpenbotConversationReceipt = Schema.Struct({
  messageId: Id,
  deliveries: Schema.Array(
    Schema.Struct({
      id: Id,
      recipientAgentId: Id,
      status: OpenbotQueueDelivery.fields.status,
      position: Schema.NullOr(Count),
    }),
  ).check(Schema.isMaxLength(100)),
});
