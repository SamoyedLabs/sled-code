// @effect-diagnostics nodeBuiltinImport:off -- exact-byte dedicated binding.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { PRIVILEGED_RESPONSE_CAPABILITY } from "@t3tools/contracts/openbot-privileged-response";
import { signPrivilegedResponseBinding } from "./PrivilegedResponseBinding.ts";
import { TeamClientError } from "./TeamClient.ts";
export interface PrivilegedTransport {
  readonly available: Effect.Effect<boolean, TeamClientError>;
  readonly post: (input: {
    principal: string;
    environmentId: string;
    hostId: string;
    path: string;
    body: string;
  }) => Effect.Effect<unknown, TeamClientError>;
}
export function createTeamPrivilegedClient(ports: {
  secret: string;
  isClosed(): boolean;
  authenticated(path: string, method: "GET" | "POST"): HttpClientRequest.HttpClientRequest;
  send(
    request: HttpClientRequest.HttpClientRequest,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, TeamClientError>;
  json(response: HttpClientResponse.HttpClientResponse): Effect.Effect<unknown, TeamClientError>;
}): PrivilegedTransport {
  const fail = () => new TeamClientError({ reason: "invalid-configuration" });
  const available = Effect.gen(function* () {
    if (ports.isClosed()) return false;
    const value = yield* ports
      .send(ports.authenticated("/v1/compatibility", "GET"))
      .pipe(Effect.flatMap(ports.json));
    return (
      typeof value === "object" &&
      value !== null &&
      "capabilities" in value &&
      Array.isArray(value.capabilities) &&
      value.capabilities.includes(PRIVILEGED_RESPONSE_CAPABILITY)
    );
  }).pipe(Effect.mapError(fail), Effect.withTracerEnabled(false));
  return {
    available,
    post: Effect.fnUntraced(
      function* (input) {
        if (ports.isClosed()) return yield* fail();
        const bytes = Buffer.from(input.body, "utf8");
        if (bytes.byteLength > 1_100_000) return yield* fail();
        const now = yield* Clock.currentTimeMillis;
        const token = yield* Effect.try({
          try: () =>
            signPrivilegedResponseBinding(
              ports.secret,
              {
                principal: input.principal,
                environmentId: input.environmentId,
                hostId: input.hostId,
                method: "POST",
                path: input.path,
                bodySha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
              },
              now,
            ),
          catch: fail,
        });
        return yield* ports
          .send(
            ports
              .authenticated(input.path, "POST")
              .pipe(
                HttpClientRequest.setHeader("x-sled-privileged-response-binding", token),
                HttpClientRequest.bodyUint8Array(bytes, "application/json"),
              ),
          )
          .pipe(Effect.flatMap(ports.json));
      },
      Effect.mapError(fail),
      Effect.withTracerEnabled(false),
    ),
  };
}
