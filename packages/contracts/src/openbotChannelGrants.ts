import * as Schema from "effect/Schema";
import { IsoDateTime } from "./baseSchemas.ts";
import { OpenbotCodingPolicyDefaults } from "./openbotCodingPolicy.ts";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const OpenbotChannelGrant = Schema.Struct({
  id: Id,
  hostId: Id,
  agentId: Id,
  channelId: Id,
  requesterKind: Schema.Literals(["routine", "agent"]),
  requesterId: Id,
  defaults: OpenbotCodingPolicyDefaults,
  expiresAt: IsoDateTime,
  revoked: Schema.Boolean,
});
export type OpenbotChannelGrant = typeof OpenbotChannelGrant.Type;
export const OpenbotChannelGrantCommand = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list"), hostId: Id }),
  Schema.Struct({
    action: Schema.Literal("create"),
    operationId: Id,
    hostId: Id,
    agentId: Id,
    channelId: Id,
    requesterKind: Schema.Literals(["routine", "agent"]),
    requesterId: Id,
    defaults: OpenbotCodingPolicyDefaults,
    expiresAt: IsoDateTime,
  }),
  Schema.Struct({ action: Schema.Literal("revoke"), hostId: Id, id: Id }),
]);
export type OpenbotChannelGrantCommand = typeof OpenbotChannelGrantCommand.Type;
