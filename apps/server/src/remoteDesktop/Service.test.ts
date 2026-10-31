import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthDesktopOperateScope,
  AuthSessionId,
  RemoteDesktopError,
  type RemoteDesktopNativeCommand,
  type RemoteDesktopNativeEvent,
  type RemoteDesktopNativeResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Authority from "./Authority.ts";
import * as NativeChannel from "./NativeChannel.ts";
import * as RemoteDesktop from "./Service.ts";
import * as Connectivity from "./Connectivity.ts";

const owner: Authority.Owner = {
  sessionId: AuthSessionId.make("desktop-owner"),
  subject: "owner",
  scopes: [AuthDesktopOperateScope],
};
const other: Authority.Owner = { ...owner, sessionId: AuthSessionId.make("other-owner") };
const input = {
  clientNonce: "10000000-0000-4000-8000-000000000001",
  clientFingerprint: "A".repeat(43),
  hostFingerprint: "B".repeat(43),
  offer: "v=0\r\n",
};
const setup = Effect.fn("RemoteDesktopTest.setup")(function* (
  options: {
    holdStart?: boolean;
    wrongAnswer?: boolean;
    refuseAfterStart?: boolean;
    disabled?: boolean;
    deniedPermissions?: boolean;
    relay?: boolean;
    connectivityExpiresAt?: number;
    rotatedConnectivityExpiresAt?: number;
    wrongRestartAnswer?: boolean;
    holdRotation?: boolean;
  } = {},
) {
  const commands: RemoteDesktopNativeCommand[] = [];
  const credentialRequests: string[] = [];
  const stopped = yield* Queue.unbounded<string>();
  const invalidated = yield* Deferred.make<void>();
  const started = yield* Deferred.make<Extract<RemoteDesktopNativeCommand, { type: "start" }>>();
  const answer = yield* Deferred.make<RemoteDesktopNativeResult>();
  const rotationStarted = yield* Deferred.make<void>();
  const rotationPermit = yield* Deferred.make<void>();
  const events = yield* PubSub.bounded<RemoteDesktopNativeEvent>(16);
  let allowed = true;
  let authorizationReads = 0;
  const authority = Authority.Authority.of({
    authorize: () =>
      Effect.suspend(() => {
        authorizationReads++;
        return allowed && !(options.refuseAfterStart && authorizationReads > 2)
          ? Effect.succeed(3_600_000)
          : Effect.fail(new RemoteDesktopError({ reason: "revoked" }));
      }),
    invalidated: () => Deferred.await(invalidated),
  });
  const native = NativeChannel.NativeChannel.of({
    available: true,
    subscribe: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    request: (command) =>
      Effect.gen(function* () {
        commands.push(command);
        switch (command.type) {
          case "status":
            return {
              type: "status" as const,
              status: {
                ...(options.deniedPermissions
                  ? { permissions: { screenRecording: false, accessibility: true } }
                  : {}),
                available: true,
                enabled: true,
                remoteEnabled: !options.disabled,
                internetEnabled: true,
                hostFingerprint: input.hostFingerprint,
              },
            };
          case "start":
            yield* Deferred.succeed(started, command);
            if (options.holdStart) return yield* Deferred.await(answer);
            return {
              type: "answer" as const,
              answer: "v=0\r\n",
              sessionId: command.sessionId,
              clientNonce: command.clientNonce,
              expiresAt: command.expiresAt,
              hostFingerprint: options.wrongAnswer ? "C".repeat(43) : command.hostFingerprint,
            };
          case "renew":
            return { ...command, type: "renewed" as const };
          case "restart":
            return {
              ...command,
              type: "answer" as const,
              answer: "v=0\r\n",
              hostFingerprint: options.wrongRestartAnswer
                ? "C".repeat(43)
                : command.hostFingerprint,
            };
          case "stop":
            yield* Queue.offer(stopped, command.sessionId);
            return { ...command, type: "stopped" as const };
        }
      }),
  });
  const context = yield* Layer.build(
    RemoteDesktop.layer.pipe(
      Layer.provide(Layer.succeed(Authority.Authority, authority)),
      Layer.provide(Layer.succeed(NativeChannel.NativeChannel, native)),
      Layer.provide(NodeCrypto.layer),
      Layer.provide(
        Layer.succeed(
          Connectivity.Connectivity,
          Connectivity.Connectivity.of({
            get: (ownerId) =>
              Effect.gen(function* () {
                credentialRequests.push(ownerId);
                if (options.holdRotation && credentialRequests.length > 1) {
                  yield* Deferred.succeed(rotationStarted, undefined);
                  yield* Deferred.await(rotationPermit);
                }
                return {
                  iceServers: [],
                  expiresAt:
                    credentialRequests.length > 1
                      ? (options.rotatedConnectivityExpiresAt ??
                        options.connectivityExpiresAt ??
                        3_600_000)
                      : (options.connectivityExpiresAt ?? 3_600_000),
                  relayAvailable: options.relay ?? false,
                  relayOnly: false,
                };
              }),
          }),
        ),
      ),
    ),
  );
  return {
    service: Context.get(context, RemoteDesktop.Service),
    commands,
    credentialRequests,
    stopped,
    started,
    answer,
    events,
    rotationStarted,
    rotationPermit,
    revoke: Effect.sync(() => {
      allowed = false;
    }).pipe(Effect.andThen(Deferred.succeed(invalidated, undefined))),
  };
});

describe("RemoteDesktop session ownership and leases", () => {
  it.effect("does not restart a revoked device after slow credential issuance completes", () =>
    Effect.gen(function* () {
      const f = yield* setup({ holdRotation: true });
      const answer = yield* f.service.start(owner, input);
      const pending = yield* f.service
        .restart(owner, { sessionId: answer.sessionId, offer: input.offer })
        .pipe(Effect.forkChild);
      yield* Deferred.await(f.rotationStarted);
      yield* f.revoke;
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
      yield* Deferred.succeed(f.rotationPermit, undefined);
      expect(yield* Fiber.join(pending).pipe(Effect.flip)).toMatchObject({ reason: "revoked" });
      expect(f.commands.filter((c) => c.type === "restart")).toHaveLength(0);
    }).pipe(Effect.scoped),
  );
  it.effect(
    "extends a live relay session past the old credential deadline only after a pinned restart answer",
    () =>
      Effect.gen(function* () {
        const f = yield* setup({
          relay: true,
          connectivityExpiresAt: 70_000,
          rotatedConnectivityExpiresAt: 130_000,
        });
        const answer = yield* f.service.start(owner, input);
        yield* TestClock.adjust("20 seconds");
        yield* f.service.restart(owner, { sessionId: answer.sessionId, offer: input.offer });
        yield* TestClock.adjust("20 seconds");
        expect((yield* f.service.renew(owner, { sessionId: answer.sessionId })).expiresAt).toBe(
          70_000,
        );
        yield* TestClock.adjust("20 seconds");
        expect((yield* f.service.renew(owner, { sessionId: answer.sessionId })).expiresAt).toBe(
          90_000,
        );
        expect(f.commands.filter((c) => c.type === "stop")).toHaveLength(0);
        const wrong = yield* setup({ wrongRestartAnswer: true });
        const initial = yield* wrong.service.start(owner, input);
        expect(
          yield* wrong.service
            .restart(owner, { sessionId: initial.sessionId, offer: input.offer })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "identity_mismatch" });
        expect(yield* Queue.take(wrong.stopped)).toBe(initial.sessionId);
      }).pipe(Effect.scoped),
  );
  it.effect("renews TURN material only for the owning active session and preserves its pins", () =>
    Effect.gen(function* () {
      const f = yield* setup({ relay: true });
      const answer = yield* f.service.start(owner, input);
      const restart = { sessionId: answer.sessionId, offer: "v=0\r\na=ice-ufrag:new\r\n" };
      expect(yield* f.service.restart(other, restart).pipe(Effect.flip)).toMatchObject({
        reason: "not_found",
      });
      expect(f.credentialRequests).toHaveLength(1);
      yield* TestClock.adjust("10 seconds");
      expect(yield* f.service.restart(owner, restart)).toMatchObject({
        sessionId: answer.sessionId,
        clientNonce: input.clientNonce,
        hostFingerprint: input.hostFingerprint,
        expiresAt: 40_000,
      });
      expect(f.commands.find((command) => command.type === "restart")).toMatchObject({
        ...restart,
        clientNonce: input.clientNonce,
        hostFingerprint: input.hostFingerprint,
      });
      expect(f.credentialRequests).toHaveLength(2);
      yield* f.revoke;
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
      expect(yield* f.service.restart(owner, restart).pipe(Effect.flip)).toMatchObject({
        reason: "not_found",
      });
    }).pipe(Effect.scoped),
  );
  it.effect("does not issue relay credentials while desktop access is disabled or revoked", () =>
    Effect.gen(function* () {
      const disabled = yield* setup({ disabled: true });
      expect((yield* disabled.service.status(owner)).remoteEnabled).toBe(false);
      expect(yield* disabled.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "disabled",
      });
      expect(disabled.credentialRequests).toHaveLength(0);
      const denied = yield* setup({ deniedPermissions: true });
      expect((yield* denied.service.status(owner)).permissions?.screenRecording).toBe(false);
      expect(yield* denied.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "disabled",
      });
      expect(denied.credentialRequests).toHaveLength(0);
      const revoked = yield* setup();
      yield* revoked.revoke;
      expect(yield* revoked.service.status(owner).pipe(Effect.flip)).toMatchObject({
        reason: "revoked",
      });
      expect(yield* revoked.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "revoked",
      });
      expect(revoked.credentialRequests).toHaveLength(0);
    }).pipe(Effect.scoped),
  );
  it.effect("never renews a relayed session beyond its issued TURN credential deadline", () =>
    Effect.gen(function* () {
      const f = yield* setup({ relay: true, connectivityExpiresAt: 70_000 });
      const answer = yield* f.service.start(owner, input);
      yield* TestClock.adjust("20 seconds");
      yield* f.service.renew(owner, { sessionId: answer.sessionId });
      yield* TestClock.adjust("20 seconds");
      expect((yield* f.service.renew(owner, { sessionId: answer.sessionId })).expiresAt).toBe(
        60_000,
      );
      yield* TestClock.adjust("20 seconds");
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("binds native admission to the owner, host pin, client nonce and server deadline", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      expect(answer).toMatchObject({
        clientNonce: input.clientNonce,
        hostFingerprint: input.hostFingerprint,
        answer: "v=0\r\n",
        expiresAt: 30_000,
      });
      expect(answer.sessionId).not.toBe(input.clientNonce);
      expect(f.commands.find((command) => command.type === "start")).toMatchObject({
        type: "start",
        sessionId: answer.sessionId,
        expiresAt: 30_000,
      });
      yield* f.service.stop(owner, { sessionId: answer.sessionId });
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("prevents another T3 session from renewing or closing the native session", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      for (const method of [f.service.renew, f.service.stop]) {
        expect(
          yield* method(other, { sessionId: answer.sessionId }).pipe(Effect.flip),
        ).toMatchObject({ reason: "not_found" });
      }
      expect(f.commands.filter((c) => c.type === "renew" || c.type === "stop")).toEqual([]);
    }).pipe(Effect.scoped),
  );
  it.effect("closes an idle native peer when the T3 device is revoked", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      yield* f.revoke;
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
      expect(
        yield* f.service.renew(owner, { sessionId: answer.sessionId }).pipe(Effect.flip),
      ).toMatchObject({ reason: "not_found" });
      expect(yield* f.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "revoked",
      });
    }).pipe(Effect.scoped),
  );
  it.effect("expires an otherwise healthy peer when signaling stops renewing its lease", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      yield* TestClock.adjust("30 seconds");
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("renews the native lease and cancels the previous expiry deadline", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      yield* TestClock.adjust("10 seconds");
      expect(yield* f.service.renew(owner, { sessionId: answer.sessionId })).toEqual({
        sessionId: answer.sessionId,
        expiresAt: 40_000,
      });
      yield* TestClock.adjust("20 seconds");
      expect(f.commands.some((command) => command.type === "stop")).toBe(false);
      yield* TestClock.adjust("10 seconds");
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("rejects a native reply with a different host identity and releases its peer", () =>
    Effect.gen(function* () {
      const f = yield* setup({ wrongAnswer: true });
      expect(yield* f.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "identity_mismatch",
      });
      expect(yield* Queue.take(f.stopped)).toBe((yield* Deferred.await(f.started)).sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("rechecks persisted authorization after the native handshake", () =>
    Effect.gen(function* () {
      const f = yield* setup({ refuseAfterStart: true });
      expect(yield* f.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "revoked",
      });
      expect(yield* Queue.take(f.stopped)).toBe((yield* Deferred.await(f.started)).sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("cancels admission on revocation and ignores a late answer", () =>
    Effect.gen(function* () {
      const f = yield* setup({ holdStart: true });
      const pending = yield* f.service.start(owner, input).pipe(Effect.forkChild);
      const command = yield* Deferred.await(f.started);
      yield* f.revoke;
      expect(yield* Queue.take(f.stopped)).toBe(command.sessionId);
      expect(yield* Fiber.join(pending).pipe(Effect.flip)).toMatchObject({ reason: "revoked" });
      yield* Deferred.succeed(f.answer, { ...command, type: "answer", answer: "v=0\r\n" });
      expect(
        yield* f.service.renew(owner, { sessionId: command.sessionId }).pipe(Effect.flip),
      ).toMatchObject({ reason: "not_found" });
    }).pipe(Effect.scoped),
  );
  it.effect("releases native admission when the initiating RPC is interrupted", () =>
    Effect.gen(function* () {
      const f = yield* setup({ holdStart: true });
      const pending = yield* f.service.start(owner, input).pipe(Effect.forkChild);
      const command = yield* Deferred.await(f.started);
      yield* Fiber.interrupt(pending);
      expect(yield* Queue.take(f.stopped)).toBe(command.sessionId);
    }).pipe(Effect.scoped),
  );
  it.effect("bounds concurrent sessions and rejects a reused active client nonce", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      yield* f.service.start(owner, input);
      expect(yield* f.service.start(owner, input).pipe(Effect.flip)).toMatchObject({
        reason: "limit",
      });
      yield* f.service.start(owner, {
        ...input,
        clientNonce: "10000000-0000-4000-8000-000000000002",
      });
      expect(
        yield* f.service
          .start(owner, { ...input, clientNonce: "10000000-0000-4000-8000-000000000003" })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "limit" });
    }).pipe(Effect.scoped),
  );
  it.effect("releases a session when the native helper reports it closed", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const answer = yield* f.service.start(owner, input);
      yield* PubSub.publish(f.events, { type: "closed", sessionId: answer.sessionId });
      expect(yield* Queue.take(f.stopped)).toBe(answer.sessionId);
      expect(
        yield* f.service.renew(owner, { sessionId: answer.sessionId }).pipe(Effect.flip),
      ).toMatchObject({ reason: "not_found" });
    }).pipe(Effect.scoped),
  );
});
