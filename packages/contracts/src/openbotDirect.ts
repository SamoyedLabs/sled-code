import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const OpenbotPerson = Schema.Struct({
  id: Id,
  username: Schema.String,
  email: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  disabled: Schema.Boolean,
  online: Schema.Boolean,
});
export type OpenbotPerson = typeof OpenbotPerson.Type;
export const OpenbotPeople = Schema.Struct({
  serverId: Schema.NullOr(Id),
  members: Schema.Array(OpenbotPerson).check(Schema.isMaxLength(10_000)),
  updatedAt: Schema.String,
});
export const OpenbotDirectSelf = Schema.Struct({ id: Id });
export const OpenbotDirectMessage = Schema.Struct({
  id: Id,
  threadId: Id,
  senderMemberId: Id,
  recipientMemberId: Id,
  text: Schema.String.check(Schema.isMaxLength(20_000)),
  createdAt: Schema.String,
  sequence: Count,
});
export type OpenbotDirectMessage = typeof OpenbotDirectMessage.Type;
export const OpenbotDirectThread = Schema.Struct({
  threadId: Id,
  otherMemberId: Id,
  lastMessage: OpenbotDirectMessage,
  unreadCount: Count,
  updatedAt: Schema.String,
});
export const OpenbotDirectThreads = Schema.Array(OpenbotDirectThread).check(
  Schema.isMaxLength(10_000),
);
export type OpenbotDirectThread = typeof OpenbotDirectThread.Type;
export const OpenbotDirectReadState = Schema.Struct({
  unreadCount: Count,
  firstUnreadMessageId: Schema.NullOr(Id),
  throughSequence: Count,
});
export const OpenbotDirectPage = Schema.Struct({
  threadId: Id,
  otherMemberId: Id,
  messages: Schema.Array(OpenbotDirectMessage).check(Schema.isMaxLength(100)),
  revision: Count,
  pageInfo: Schema.Struct({
    hasOlder: Schema.Boolean,
    olderCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
    olderCount: Schema.optional(Count),
    oldestAt: Schema.optional(Schema.String),
  }),
  readState: Schema.optional(OpenbotDirectReadState),
});
export type OpenbotDirectPage = typeof OpenbotDirectPage.Type;
export const OpenbotDirectReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("direct.people") }),
  Schema.Struct({ operation: Schema.Literal("direct.self") }),
  Schema.Struct({ operation: Schema.Literal("direct.threads") }),
  Schema.Struct({
    operation: Schema.Literal("direct.page"),
    memberId: Id,
    anchor: Schema.Union([
      Schema.Struct({ type: Schema.Literal("latest") }),
      Schema.Struct({
        type: Schema.Literal("before"),
        cursor: Schema.String.check(Schema.isMaxLength(2048)),
      }),
      Schema.Struct({ type: Schema.Literal("around"), messageId: Id }),
    ]),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  }),
]);
export type OpenbotDirectReadRequest = typeof OpenbotDirectReadRequest.Type;
export const OpenbotDirectCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("direct.send"),
    memberId: Id,
    text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
    clientMessageId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("direct.markRead"),
    memberId: Id,
    throughSequence: Count,
  }),
]);
export type OpenbotDirectCommand = typeof OpenbotDirectCommand.Type;
