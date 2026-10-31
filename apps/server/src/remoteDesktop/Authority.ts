import {
  AuthDesktopOperateScope,
  RemoteDesktopError,
  type AuthSessionId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";

export type Owner = Pick<AuthenticatedSession, "sessionId" | "subject" | "scopes">;
export class AuthorizationLookupError extends Schema.TaggedError<AuthorizationLookupError>()(
  "RemoteDesktopAuthorizationLookupError",
  {
    sessionId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not verify remote desktop authorization.";
  }
}

export class Authority extends Context.Service<
  Authority,
  {
    readonly authorize: (
      owner: Owner,
    ) => Effect.Effect<number, RemoteDesktopError | AuthorizationLookupError>;
    readonly invalidated: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<void, AuthorizationLookupError>;
  }
>()("t3/remoteDesktop/Authority") {}

const make = Effect.gen(function* () {
  const repository = yield* AuthSessions.AuthSessionRepository;
  const sessions = yield* SessionStore.SessionStore;
  return Authority.of({
    authorize: Effect.fn("RemoteDesktopAuthority.authorize")(function* (owner) {
      if (!owner.scopes.includes(AuthDesktopOperateScope)) {
        return yield* new RemoteDesktopError({ reason: "forbidden" });
      }
      const row = yield* repository
        .getById({ sessionId: owner.sessionId })
        .pipe(
          Effect.mapError(
            (cause) => new AuthorizationLookupError({ sessionId: owner.sessionId, cause }),
          ),
        );
      if (Option.isNone(row) || row.value.revokedAt !== null) {
        return yield* new RemoteDesktopError({ reason: "revoked" });
      }
      if (
        row.value.subject !== owner.subject ||
        !row.value.scopes.includes(AuthDesktopOperateScope)
      ) {
        return yield* new RemoteDesktopError({ reason: "forbidden" });
      }
      const now = yield* DateTime.now;
      if (row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds) {
        return yield* new RemoteDesktopError({ reason: "expired" });
      }
      return row.value.expiresAt.epochMilliseconds;
    }),
    invalidated: Effect.fn("RemoteDesktopAuthority.invalidated")(function (sessionId) {
      return sessions
        .awaitInvalidation(sessionId)
        .pipe(Effect.mapError((cause) => new AuthorizationLookupError({ sessionId, cause })));
    }),
  });
});
export const layer = Layer.effect(Authority, make);
