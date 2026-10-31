// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect Crypto does not expose the HMAC required by coturn's REST credential format.
import * as NodeCrypto from "node:crypto";
import { RemoteDesktopConnectivity, RemoteDesktopIceServer } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

const Secret = Schema.RedactedFromValue(
  Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(4096)),
);
const CredentialLifetime = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(600),
  Schema.isLessThanOrEqualTo(3600),
);
const Configuration = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal("cloudflare"),
    keyId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/)),
    apiToken: Secret,
    relayOnly: Schema.optionalKey(Schema.Boolean),
    ttlSeconds: Schema.optionalKey(CredentialLifetime),
  }),
  Schema.Struct({
    provider: Schema.Literal("coturn"),
    urls: RemoteDesktopIceServer.fields.urls,
    sharedSecret: Secret,
    relayOnly: Schema.optionalKey(Schema.Boolean),
    ttlSeconds: Schema.optionalKey(CredentialLifetime),
  }),
]);
const ProviderResponse = Schema.Struct({ iceServers: RemoteDesktopConnectivity.fields.iceServers });
const decodeConfiguration = Schema.decodeEffect(Schema.fromJsonString(Configuration));
const decodeIssued = Schema.decodeEffect(Schema.fromJsonString(ProviderResponse));
const decodeConnectivity = Schema.decodeEffect(RemoteDesktopConnectivity);
export class ConnectivityError extends Schema.TaggedError<ConnectivityError>()(
  "RemoteDesktopConnectivityError",
  {
    cause: Schema.Redacted(Schema.Defect(), { disallowJsonEncode: true }),
  },
) {
  override get message(): string {
    return "Remote desktop connectivity could not be configured.";
  }
}
export class Connectivity extends Context.Service<
  Connectivity,
  {
    readonly get: (ownerId: string) => Effect.Effect<RemoteDesktopConnectivity, ConnectivityError>;
  }
>()("t3/remoteDesktop/Connectivity") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  // An owner gets its own TURN credentials. Cache and provider calls are bounded;
  // reading config each time makes removal/key rotation take effect immediately.
  const cache = new Map<string, { marker: string; config: RemoteDesktopConnectivity }>();
  const get = Effect.fn("RemoteDesktopConnectivity.get")(
    function* (ownerId: string) {
      const now = (yield* DateTime.now).epochMilliseconds;
      const stored = yield* secrets.get("remote-desktop-turn");
      if (Option.isNone(stored)) {
        cache.clear();
        return {
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          expiresAt: now + 600_000,
          relayOnly: false,
          relayAvailable: false,
        };
      }
      if (stored.value.byteLength > 16_384) return yield* Effect.fail("configuration-limit");
      const text = new TextDecoder().decode(stored.value);
      const markerBytes = yield* crypto.digest("SHA-256", stored.value);
      const marker = Array.from(markerBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const configuration = yield* decodeConfiguration(text);
      const ttl = configuration.ttlSeconds ?? 3600;
      const refreshWindow = Math.min(600_000, ttl * 500);
      for (const [key, entry] of cache) {
        if (entry.marker !== marker || entry.config.expiresAt <= now + refreshWindow)
          cache.delete(key);
      }
      const cached = cache.get(ownerId);
      if (cached) return cached.config;
      if (cache.size >= 32) return yield* Effect.fail("credential-limit");
      const expiresAt = now + ttl * 1000;
      let config: RemoteDesktopConnectivity;
      if (configuration.provider === "coturn") {
        const suffix = yield* crypto.randomUUIDv4();
        const username = `${Math.floor(expiresAt / 1000)}:${suffix}`;
        const credential = NodeCrypto.createHmac("sha1", Redacted.value(configuration.sharedSecret))
          .update(username)
          .digest("base64");
        config = yield* decodeConnectivity({
          iceServers: [{ urls: configuration.urls, username, credential }],
          expiresAt,
          relayOnly: configuration.relayOnly ?? false,
          relayAvailable: configuration.urls.some(
            (url) => url.startsWith("turn:") || url.startsWith("turns:"),
          ),
        });
      } else {
        const request = yield* HttpClientRequest.bodyJson({ ttl })(
          HttpClientRequest.post(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${configuration.keyId}/credentials/generate-ice-servers`,
          ).pipe(HttpClientRequest.bearerToken(configuration.apiToken)),
        );
        const response = yield* http.execute(request);
        // Read a bounded byte stream; response.json can buffer an unlimited fetch body.
        const decoder = new TextDecoder();
        const body = yield* response.stream.pipe(
          Stream.runFoldEffect(
            () => ({ size: 0, text: "" }),
            (state, chunk) =>
              state.size + chunk.byteLength > 16_384
                ? Effect.fail("provider-response-limit")
                : Effect.succeed({
                    size: state.size + chunk.byteLength,
                    text: state.text + decoder.decode(chunk, { stream: true }),
                  }),
          ),
        );
        if (response.status !== 201) return yield* Effect.fail("provider-refused");
        const issued = yield* decodeIssued(body.text + decoder.decode());
        const iceServers = issued.iceServers
          .map((server) => ({
            ...server,
            urls: server.urls.filter((url) => !/:53(?:\?|$)/.test(url)),
          }))
          .filter((server) => server.urls.length > 0);
        config = yield* decodeConnectivity({
          iceServers,
          expiresAt,
          relayOnly: configuration.relayOnly ?? false,
          relayAvailable: iceServers.some((server) =>
            server.urls.some((url) => !url.startsWith("stun:")),
          ),
        });
        if (!config.relayAvailable) return yield* Effect.fail("provider-missing-relay");
      }
      cache.set(ownerId, { marker, config });
      return config;
    },
    lock.withPermits(1),
    Effect.timeout("10 seconds"),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.mapError((cause) => new ConnectivityError({ cause: Redacted.make(cause) })),
  );
  return Connectivity.of({ get });
});
export const layer = Layer.effect(Connectivity, make);
