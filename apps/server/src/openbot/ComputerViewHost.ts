import { AuthDesktopOperateScope, AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SessionStore from "../auth/SessionStore.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as Integration from "./Integration.ts";
import * as Gateway from "./ComputerViewGateway.ts";

// Adapter for private Promise HTTP/socket callbacks using the enclosing application context.
const make = Effect.gen(function* () {
  const integration = yield* Integration.Integration;
  const repository = yield* AuthSessions.AuthSessionRepository;
  const sessions = yield* SessionStore.SessionStore;
  const run = Effect.runPromiseWith(yield* Effect.context<never>());
  const authorize = Effect.fn("ComputerViewHost.authorize")(function* (
    principal: string,
    hostId: string,
  ) {
    const row = yield* repository.getById({ sessionId: AuthSessionId.make(principal) });
    const now = yield* DateTime.now;
    if (
      Option.isNone(row) ||
      row.value.revokedAt !== null ||
      row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds ||
      !row.value.scopes.includes(AuthDesktopOperateScope) ||
      (yield* integration.readyHostId) !== hostId
    )
      return yield* new Gateway.ComputerViewError({ reason: "unavailable" });
  });
  return Gateway.ComputerViewHost.of({
    authorize: (principal, hostId) => run(authorize(principal, hostId)),
    create: (hostId) => run(integration.withComputerToHost(hostId)),
    watch: Effect.fn("ComputerViewHost.watch")((invalidate) =>
      Stream.merge(sessions.streamChanges, integration.readyChanges).pipe(
        Stream.runForEach(() => Effect.promise(invalidate).pipe(Effect.ignore)),
        Effect.forkScoped,
        Effect.asVoid,
      ),
    ),
  });
});
export const layer = Layer.effect(Gateway.ComputerViewHost, make).pipe(
  Layer.provide(AuthSessions.layer),
);
