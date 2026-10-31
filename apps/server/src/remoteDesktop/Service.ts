import {
  RemoteDesktopError,
  type RemoteDesktopAnswer,
  type RemoteDesktopLease,
  type RemoteDesktopNativeResult,
  type RemoteDesktopSessionInput,
  type RemoteDesktopStartInput,
  type RemoteDesktopRestartInput,
  type RemoteDesktopStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as Authority from "./Authority.ts";
import * as NativeChannel from "./NativeChannel.ts";
import * as Connectivity from "./Connectivity.ts";

export type RequestFailure =
  | RemoteDesktopError
  | Authority.AuthorizationLookupError
  | Connectivity.ConnectivityError
  | NativeChannel.NativeControlWriteError;
interface Session {
  readonly id: string;
  readonly owner: Authority.Owner;
  readonly nonce: string;
  readonly stopped: Deferred.Deferred<void>;
  readonly renewals: Queue.Queue<void>;
  readonly renewLock: Semaphore.Semaphore;
  readonly hostFingerprint: string;
  connectivityExpiresAt: number;
  expiresAt: number;
}
export class Service extends Context.Service<
  Service,
  {
    readonly status: (owner: Authority.Owner) => Effect.Effect<RemoteDesktopStatus, RequestFailure>;
    readonly start: (
      owner: Authority.Owner,
      input: RemoteDesktopStartInput,
    ) => Effect.Effect<RemoteDesktopAnswer, RequestFailure>;
    readonly renew: (
      owner: Authority.Owner,
      input: RemoteDesktopSessionInput,
    ) => Effect.Effect<RemoteDesktopLease, RequestFailure>;
    readonly restart: (
      owner: Authority.Owner,
      input: RemoteDesktopRestartInput,
    ) => Effect.Effect<RemoteDesktopAnswer, RequestFailure>;
    readonly stop: (
      owner: Authority.Owner,
      input: RemoteDesktopSessionInput,
    ) => Effect.Effect<void, RequestFailure>;
  }
>()("t3/remoteDesktop/Service") {}

const make = Effect.gen(function* () {
  const native = yield* NativeChannel.NativeChannel;
  const authority = yield* Authority.Authority;
  const connectivity = yield* Connectivity.Connectivity;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Scope.Scope;
  const sessions = new Map<string, Session>();
  const leaseMillis = 30_000;
  const nativeResult = (result: RemoteDesktopNativeResult) =>
    result.type === "error"
      ? Effect.fail(new RemoteDesktopError({ reason: result.reason }))
      : Effect.succeed(result);

  const close = Effect.fn("RemoteDesktop.close")(function* (session: Session) {
    if (sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    yield* Deferred.succeed(session.stopped, undefined);
    yield* native.request({ type: "stop", sessionId: session.id }).pipe(Effect.ignore);
    yield* Queue.shutdown(session.renewals);
  });
  const find = (owner: Authority.Owner, id: string) => {
    const session = sessions.get(id);
    return session?.owner.sessionId === owner.sessionId && session.owner.subject === owner.subject
      ? Effect.succeed(session)
      : Effect.fail(new RemoteDesktopError({ reason: "not_found" }));
  };

  const nativeEvents = yield* native.subscribe;
  yield* nativeEvents.pipe(
    Stream.runForEach((event) => {
      const affected =
        event.type === "unavailable"
          ? [...sessions.values()]
          : event.type === "closed"
            ? [...sessions.values()].filter((session) => session.id === event.sessionId)
            : [];
      return Effect.forEach(affected, close, { discard: true });
    }),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...sessions.values()], close, { discard: true }),
  );

  const watch = Effect.fn("RemoteDesktop.watch")(function* (session: Session) {
    yield* authority.invalidated(session.owner.sessionId).pipe(
      Effect.ignoreCause,
      Effect.raceFirst(Deferred.await(session.stopped)),
      // close signals stopped itself; keep cleanup outside the race so it
      // cannot interrupt its own native stop request.
      Effect.andThen(close(session)),
      Effect.forkIn(scope),
    );
    yield* Effect.gen(function* () {
      while (sessions.get(session.id) === session) {
        const now = yield* DateTime.now;
        if (session.expiresAt <= now.epochMilliseconds) {
          yield* close(session);
          return;
        }
        yield* Effect.raceFirst(
          Deferred.await(session.stopped),
          Queue.take(session.renewals).pipe(
            Effect.timeoutOption(session.expiresAt - now.epochMilliseconds),
          ),
        );
      }
    }).pipe(Effect.forkIn(scope));
  });

  return Service.of({
    status: Effect.fn("RemoteDesktop.status")(function* (owner) {
      yield* authority.authorize(owner);
      if (!native.available)
        return {
          available: false,
          enabled: false,
          remoteEnabled: false,
          internetEnabled: false,
          hostFingerprint: null,
        };
      const reply = yield* native.request({ type: "status" }).pipe(Effect.flatMap(nativeResult));
      if (reply.type !== "status") return yield* new RemoteDesktopError({ reason: "transport" });
      if (
        !reply.status.enabled ||
        !reply.status.remoteEnabled ||
        !reply.status.internetEnabled ||
        (reply.status.permissions &&
          (!reply.status.permissions.screenRecording || !reply.status.permissions.accessibility))
      )
        return reply.status;
      const config = yield* connectivity.get(owner.sessionId);
      // Provider I/O may outlive a revocation; never return credentials afterwards.
      yield* authority.authorize(owner);
      return { ...reply.status, connectivity: config };
    }),
    start: Effect.fn("RemoteDesktop.start")(function* (owner, input) {
      const authorizationExpiresAt = yield* authority.authorize(owner);
      if (!native.available) return yield* new RemoteDesktopError({ reason: "unavailable" });
      const host = yield* native.request({ type: "status" }).pipe(Effect.flatMap(nativeResult));
      if (host.type !== "status") return yield* new RemoteDesktopError({ reason: "transport" });
      if (!host.status.enabled || !host.status.remoteEnabled || !host.status.internetEnabled)
        return yield* new RemoteDesktopError({ reason: "disabled" });
      if (
        host.status.permissions &&
        (!host.status.permissions.screenRecording || !host.status.permissions.accessibility)
      )
        return yield* new RemoteDesktopError({ reason: "disabled" });
      if (host.status.hostFingerprint !== input.hostFingerprint)
        return yield* new RemoteDesktopError({ reason: "identity_mismatch" });
      const config = yield* connectivity.get(owner.sessionId);
      yield* authority.authorize(owner);
      const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const now = yield* DateTime.now;
      const stopped = yield* Deferred.make<void>();
      const renewals = yield* Queue.sliding<void>(1);
      const renewLock = yield* Semaphore.make(1);
      if (authorizationExpiresAt <= now.epochMilliseconds)
        return yield* new RemoteDesktopError({ reason: "expired" });
      if (
        sessions.size >= 8 ||
        [...sessions.values()].filter((session) => session.owner.sessionId === owner.sessionId)
          .length >= 2 ||
        [...sessions.values()].some((session) => session.nonce === input.clientNonce)
      ) {
        return yield* new RemoteDesktopError({ reason: "limit" });
      }
      const session: Session = {
        id,
        owner,
        nonce: input.clientNonce,
        hostFingerprint: input.hostFingerprint,
        stopped,
        renewals,
        renewLock,
        connectivityExpiresAt: config.relayAvailable
          ? config.expiresAt - 10_000
          : Number.POSITIVE_INFINITY,
        expiresAt: Math.min(authorizationExpiresAt, now.epochMilliseconds + leaseMillis),
      };
      sessions.set(id, session);
      yield* watch(session);
      const operation = Effect.gen(function* () {
        const reply = yield* native
          .request({
            type: "start",
            ...input,
            sessionId: id,
            expiresAt: session.expiresAt,
            connectivity: config,
          })
          .pipe(
            Effect.flatMap(nativeResult),
            Effect.raceFirst(
              Deferred.await(session.stopped).pipe(
                Effect.andThen(Effect.fail(new RemoteDesktopError({ reason: "revoked" }))),
              ),
            ),
          );
        const authorizationNow = yield* authority.authorize(owner);
        const returnedAt = yield* DateTime.now;
        if (sessions.get(id) !== session)
          return yield* new RemoteDesktopError({ reason: "revoked" });
        if (
          returnedAt.epochMilliseconds >= session.expiresAt ||
          authorizationNow < session.expiresAt
        ) {
          return yield* new RemoteDesktopError({ reason: "expired" });
        }
        if (
          reply.type !== "answer" ||
          reply.sessionId !== id ||
          reply.clientNonce !== input.clientNonce ||
          reply.hostFingerprint !== input.hostFingerprint ||
          reply.expiresAt !== session.expiresAt
        ) {
          return yield* new RemoteDesktopError({ reason: "identity_mismatch" });
        }
        return reply;
      });
      return yield* operation.pipe(
        Effect.onExit((exit) => (Exit.isFailure(exit) ? close(session) : Effect.void)),
      );
    }),
    restart: Effect.fn("RemoteDesktop.restart")(function* (owner, input) {
      const session = yield* find(owner, input.sessionId);
      return yield* session.renewLock.withPermits(1)(
        Effect.gen(function* () {
          if (sessions.get(session.id) !== session)
            return yield* new RemoteDesktopError({ reason: "revoked" });
          yield* authority.authorize(owner);
          const config = yield* connectivity.get(owner.sessionId);
          const authorizationExpiresAt = yield* authority.authorize(owner);
          const now = (yield* DateTime.now).epochMilliseconds;
          if (session.expiresAt <= now || sessions.get(session.id) !== session)
            return yield* new RemoteDesktopError({ reason: "expired" });
          const connectivityExpiresAt = config.relayAvailable
            ? config.expiresAt - 10_000
            : Number.POSITIVE_INFINITY;
          const expiresAt = Math.min(
            authorizationExpiresAt,
            connectivityExpiresAt,
            now + leaseMillis,
          );
          if (expiresAt <= now) return yield* new RemoteDesktopError({ reason: "expired" });
          const reply = yield* native
            .request({
              type: "restart",
              sessionId: session.id,
              offer: input.offer,
              clientNonce: session.nonce,
              hostFingerprint: session.hostFingerprint,
              expiresAt,
              connectivity: config,
            })
            .pipe(Effect.flatMap(nativeResult));
          const authorizationNow = yield* authority.authorize(owner);
          const returnedAt = (yield* DateTime.now).epochMilliseconds;
          if (sessions.get(session.id) !== session)
            return yield* new RemoteDesktopError({ reason: "revoked" });
          if (returnedAt >= expiresAt || authorizationNow < expiresAt)
            return yield* new RemoteDesktopError({ reason: "expired" });
          if (
            reply.type !== "answer" ||
            reply.sessionId !== session.id ||
            reply.clientNonce !== session.nonce ||
            reply.hostFingerprint !== session.hostFingerprint ||
            reply.expiresAt !== expiresAt
          )
            return yield* new RemoteDesktopError({ reason: "identity_mismatch" });
          session.expiresAt = expiresAt;
          session.connectivityExpiresAt = connectivityExpiresAt;
          yield* Queue.offer(session.renewals, undefined);
          return reply;
        }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close(session) : Effect.void))),
      );
    }),
    renew: Effect.fn("RemoteDesktop.renew")(function* (owner, input) {
      const session = yield* find(owner, input.sessionId);
      return yield* session.renewLock.withPermits(1)(
        Effect.gen(function* () {
          if (sessions.get(session.id) !== session)
            return yield* new RemoteDesktopError({ reason: "revoked" });
          const authorizationExpiresAt = yield* authority
            .authorize(owner)
            .pipe(Effect.onError(() => close(session)));
          const now = yield* DateTime.now;
          if (session.expiresAt <= now.epochMilliseconds) {
            yield* close(session);
            return yield* new RemoteDesktopError({ reason: "expired" });
          }
          const expiresAt = Math.min(
            authorizationExpiresAt,
            session.connectivityExpiresAt,
            now.epochMilliseconds + leaseMillis,
          );
          const reply = yield* native
            .request({ type: "renew", sessionId: session.id, expiresAt })
            .pipe(
              Effect.flatMap(nativeResult),
              Effect.onError(() => close(session)),
            );
          if (sessions.get(session.id) !== session)
            return yield* new RemoteDesktopError({ reason: "revoked" });
          const authorizationNow = yield* authority
            .authorize(owner)
            .pipe(Effect.onError(() => close(session)));
          const returnedAt = yield* DateTime.now;
          if (returnedAt.epochMilliseconds >= expiresAt || authorizationNow < expiresAt) {
            yield* close(session);
            return yield* new RemoteDesktopError({ reason: "expired" });
          }
          if (
            reply.type !== "renewed" ||
            reply.sessionId !== session.id ||
            reply.expiresAt !== expiresAt
          ) {
            yield* close(session);
            return yield* new RemoteDesktopError({ reason: "transport" });
          }
          session.expiresAt = expiresAt;
          yield* Queue.offer(session.renewals, undefined);
          return { sessionId: session.id, expiresAt };
        }),
      );
    }),
    stop: Effect.fn("RemoteDesktop.stop")(function* (owner, input) {
      yield* close(yield* find(owner, input.sessionId));
    }),
  });
});
export const layer = Layer.effect(Service, make);

// CLI-only RPC embeddings have no native desktop supervisor.
export const unavailable = Service.of({
  restart: Effect.fn("RemoteDesktop.restart")(function () {
    return Effect.fail(new RemoteDesktopError({ reason: "unavailable" }));
  }),
  status: Effect.fn("RemoteDesktop.status")(function () {
    return Effect.succeed({
      available: false,
      enabled: false,
      remoteEnabled: false,
      internetEnabled: false,
      hostFingerprint: null,
    });
  }),
  start: Effect.fn("RemoteDesktop.start")(function () {
    return Effect.fail(new RemoteDesktopError({ reason: "unavailable" }));
  }),
  renew: Effect.fn("RemoteDesktop.renew")(function () {
    return Effect.fail(new RemoteDesktopError({ reason: "unavailable" }));
  }),
  stop: Effect.fn("RemoteDesktop.stop")(function () {
    return Effect.fail(new RemoteDesktopError({ reason: "unavailable" }));
  }),
});
