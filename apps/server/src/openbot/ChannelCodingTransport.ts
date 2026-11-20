import { OpenbotChannelCodingBinding, type OpenbotChannelCodingReceipt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { TeamClientError } from "./TeamClient.ts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const AttributedReceipt = Schema.Struct({
  originRef: Hash,
  operationId: Id,
  payloadHash: Hash,
  actorId: Id,
  messageId: Id,
  channelId: Id,
  receiptId: Id,
});
export type AttributedReceipt = typeof AttributedReceipt.Type;
export const VerifiedAssignment = Schema.Struct({
  originRef: Schema.NullOr(Hash),
  requesterKind: Schema.Literals(["session", "routine", "agent"]),
  binding: OpenbotChannelCodingBinding,
  expiresAt: Schema.Number,
  payloadHash: Hash,
});
export const CodingProgress = Schema.Struct({
  eventId: Hash,
  status: Schema.Literals(["executing", "needs_input", "needs_approval"]),
  updatedAt: Schema.String,
});
export const CodingProgressReceipt = Schema.Struct({
  ...CodingProgress.fields,
  delivery: Schema.Literals(["accepted", "rejected", "uncertain"]),
});
export const ChannelStatus = Schema.Struct({
  capability: Schema.Literal("sled-channel-coding-assignment-v1"),
  available: Schema.Boolean,
  progressCapability: Schema.optional(Schema.Literal("sled-channel-coding-progress-v1")),
});
export interface ChannelCodingTransport {
  readonly progressAvailable: Effect.Effect<boolean, TeamClientError>;
  readonly progress: (
    credential: string,
    event: typeof CodingProgress.Type,
  ) => Effect.Effect<typeof CodingProgressReceipt.Type, TeamClientError>;
  readonly configure: (
    mcpServerId: string,
  ) => Effect.Effect<{ readonly configured: true }, TeamClientError>;
  readonly available: Effect.Effect<boolean, TeamClientError>;
  readonly send: (
    originRef: string,
    command: Schema.Json,
  ) => Effect.Effect<AttributedReceipt, TeamClientError>;
  readonly recover: (
    originRef: string,
    channelId: string,
    operationId: string,
  ) => Effect.Effect<AttributedReceipt | null, TeamClientError>;
  readonly verify: (
    credential: string,
    purpose: "launch" | "reconcile",
  ) => Effect.Effect<
    {
      readonly originRef: string | null;
      readonly requesterKind: "session" | "routine" | "agent";
      readonly binding: OpenbotChannelCodingBinding;
      readonly expiresAt: number;
      readonly payloadHash: string;
    },
    TeamClientError
  >;
  readonly renew: (
    credential: string,
  ) => Effect.Effect<OpenbotChannelCodingReceipt, TeamClientError>;
  readonly receipt: (
    credential: string,
  ) => Effect.Effect<OpenbotChannelCodingReceipt | null, TeamClientError>;
  readonly submit: (
    credential: string,
    text: string,
  ) => Effect.Effect<OpenbotChannelCodingReceipt, TeamClientError>;
}

export const CHANNEL_CODING_PATHS = {
  progress: "/v1/sled/channel-coding/progress",
  configure: "/v1/sled/channel-coding/configure",
  available: "/v1/sled/channel-coding/status",
  send: "/v1/sled/channel-coding/send",
  recover: "/v1/sled/channel-coding/recover",
  verify: "/v1/sled/channel-coding/verify",
  renew: "/v1/sled/channel-coding/renew",
  receipt: "/v1/sled/channel-coding/receipt",
  submit: "/v1/sled/channel-coding/submit",
} as const;
