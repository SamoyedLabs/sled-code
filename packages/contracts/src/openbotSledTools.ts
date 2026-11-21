import * as Schema from "effect/Schema";
import { AuthMcpClientAccess } from "./auth.ts";
import { IsoDateTime } from "./baseSchemas.ts";

export const OpenbotSledToolsConnectInput = Schema.Struct({ access: AuthMcpClientAccess });
export type OpenbotSledToolsConnectInput = typeof OpenbotSledToolsConnectInput.Type;
export const OpenbotSledToolsStatus = Schema.Struct({
  state: Schema.Literals([
    "disconnected",
    "connected",
    "expired",
    "host-unavailable",
    "cleanup-pending",
    "revocation-pending",
  ]),
  hostId: Schema.optional(Schema.String),
  access: Schema.optional(AuthMcpClientAccess),
  expiresAt: Schema.optional(IsoDateTime),
});
export type OpenbotSledToolsStatus = typeof OpenbotSledToolsStatus.Type;
