import { AuthSessionId } from "@t3tools/contracts";
import {
  OpenbotPrivilegedResponseError,
  type OpenbotPrivilegedExecuteInput,
  type OpenbotPrivilegedScope,
} from "@t3tools/contracts/openbot-privileged-bridge";
import {
  PRIVILEGED_RESPONSE_CAPABILITY,
  type PrivilegedResponseResult,
} from "@t3tools/contracts/openbot-privileged-response";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import * as PrivilegedResponseProtocol from "./PrivilegedResponseProtocol.ts";

export class PrivilegedResponses extends Context.Service<
  PrivilegedResponses,
  {
    readonly scope: (
      principal: string,
      hostId: string,
    ) => Effect.Effect<OpenbotPrivilegedScope, OpenbotPrivilegedResponseError>;
    readonly execute: (
      principal: string,
      input: OpenbotPrivilegedExecuteInput,
    ) => Effect.Effect<PrivilegedResponseResult, OpenbotPrivilegedResponseError>;
  }
>()("t3/openbot/PrivilegedResponses") {}
const unavailable = () => new OpenbotPrivilegedResponseError({});
const decodeSessionId = Schema.decodeEffect(AuthSessionId);
const make = Effect.gen(function* () {
  const integration = yield* Integration.Integration;
  const sessions = yield* AuthSessions.AuthSessionRepository;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const sql = yield* SqlClient.SqlClient;
  const authorize = Effect.fn("PrivilegedResponses.authorize")(function* (principal: string) {
    const sessionId = yield* decodeSessionId(principal);
    const session = yield* sessions.getById({ sessionId });
    const now = yield* Clock.currentTimeMillis;
    if (
      Option.isNone(session) ||
      session.value.revokedAt !== null ||
      session.value.expiresAt.epochMilliseconds <= now ||
      !session.value.scopes.includes("orchestration:operate") ||
      !session.value.scopes.includes("settings:write")
    )
      return yield* unavailable();
    const closed =
      yield* sql`SELECT principal FROM privileged_commit_closed WHERE principal=${principal}`;
    if (closed.length) return yield* unavailable();
  }, Effect.mapError(unavailable));
  return PrivilegedResponses.of({
    scope: Effect.fn("PrivilegedResponses.scope")(function* (principal, hostId) {
      yield* authorize(principal);
      const environmentId = yield* environment.getEnvironmentId;
      const available = yield* integration.withPrivilegedToHost(
        hostId,
        (transport) => transport.available,
      );
      return { principalId: principal, environmentId, hostId, available };
    }, Effect.mapError(unavailable)),
    // The transport and RPC middleware disable tracing; never attach request values to spans/errors.
    execute: Effect.fnUntraced(
      function* (principal, input) {
        if (input.principalId !== principal) return yield* unavailable();
        yield* authorize(principal);
        const environmentId = yield* environment.getEnvironmentId;
        return yield* integration.withPrivilegedToHost(input.hostId, (transport) =>
          Effect.gen(function* () {
            if (!(yield* transport.available))
              return yield* new TeamClient.TeamClientError({ reason: "invalid-configuration" });
            return yield* PrivilegedResponseProtocol.dispatch(input.request, {
              capabilities: new Set([PRIVILEGED_RESPONSE_CAPABILITY]),
              authorize: () => authorize(principal),
              post: (path, body) =>
                transport
                  .post({ principal, environmentId, hostId: input.hostId, path, body })
                  .pipe(Effect.mapError(unavailable)),
            }).pipe(
              Effect.mapError(
                () => new TeamClient.TeamClientError({ reason: "invalid-configuration" }),
              ),
            );
          }),
        );
      },
      Effect.mapError(unavailable),
      Effect.withTracerEnabled(false),
    ),
  });
});
export const layer = Layer.effect(PrivilegedResponses, make);
