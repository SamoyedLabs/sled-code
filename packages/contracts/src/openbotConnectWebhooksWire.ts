// Sled-owned webhook ingress; the native body HMAC and delivery deduplication remain authoritative.
import {
  adminRoute,
  fields,
  identifier,
  string,
  oneOf,
  count,
  type OptionalRouteCodec,
} from "./openbotPinnedSettings/admin-wire.ts";
export const SLED_CONNECT_WEBHOOKS_CAPABILITY = "sled-connect-webhooks-v1";
export const SLED_CONNECT_WEBHOOKS_ROUTES = {
  configuration: "/v1/sled/connect-webhooks/configuration",
  receive: "/v1/sled/connect-webhooks/receive",
} as const;
export const SLED_CONNECT_WEBHOOKS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    SLED_CONNECT_WEBHOOKS_ROUTES.configuration,
    adminRoute(
      fields({ owner: fields({ kind: oneOf("agent"), id: identifier }), id: identifier }),
      fields({ routeId: identifier }),
    ),
  ],
  [
    SLED_CONNECT_WEBHOOKS_ROUTES.receive,
    adminRoute(
      fields({
        routeId: identifier,
        timestamp: string(12),
        deliveryId: string(512),
        signature: string(80),
        bodyBase64: string(87384),
      }),
      fields({ status: count }),
    ),
  ],
]);
