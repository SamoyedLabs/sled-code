// @effect-diagnostics nodeBuiltinImport:off -- Route tokens use a dedicated HMAC domain and constant-time verification.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { ScheduledTaskWebhookOrigin } from "../scheduledTasks/ScheduledTaskService.ts";

const PREFIX = "bot.";
const DOMAIN = "sled-connect-bot-webhook-v1\n";
const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const TargetWire = Schema.fromJsonString(Schema.Tuple([Identifier, Identifier]));
const decodeWire = Schema.decodeUnknownSync(TargetWire);
const encodeWire = Schema.encodeSync(TargetWire);
interface Target {
  readonly hostId: string;
  readonly routeId: string;
}
interface Routing {
  readonly address: (hostId: string, routeId: string) => Effect.Effect<string | null>;
  readonly target: (hookId: string, token: string) => Target | null;
}
export class ConnectWebhookRouting extends Context.Reference<Routing | null>(
  "t3/openbot/ConnectWebhookRouting",
  { defaultValue: () => null },
) {}

function decodeTarget(hookId: string): Target | null {
  if (!hookId.startsWith(PREFIX) || hookId.length > 1536) return null;
  try {
    const encoded = hookId.slice(PREFIX.length);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return null;
    const [hostId, routeId] = decodeWire(bytes.toString("utf8"));
    return { hostId, routeId };
  } catch {
    return null;
  }
}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const origin = yield* ScheduledTaskWebhookOrigin;
  const key = yield* secrets.getOrCreateRandom("openbot-connect-webhooks-v1", 32);
  const tokenFor = (hookId: string) =>
    NodeCrypto.createHmac("sha256", key).update(DOMAIN).update(hookId).digest("base64url");
  return {
    address: Effect.fn("ConnectWebhookRouting.address")(function* (
      hostId: string,
      routeId: string,
    ) {
      const hookId = PREFIX + Buffer.from(encodeWire([hostId, routeId])).toString("base64url");
      if (!decodeTarget(hookId)) return null;
      const { relayHookBaseUrl } = yield* origin;
      if (!relayHookBaseUrl) return null;
      return `${relayHookBaseUrl}/${encodeURIComponent(hookId)}/${tokenFor(hookId)}`;
    }),
    target: (hookId: string, token: string) => {
      const target = decodeTarget(hookId);
      if (!target || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      return NodeCrypto.timingSafeEqual(Buffer.from(token), Buffer.from(tokenFor(hookId)))
        ? target
        : null;
    },
  } satisfies Routing;
});
export const layer = Layer.effect(ConnectWebhookRouting, make);
