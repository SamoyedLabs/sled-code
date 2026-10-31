// @effect-diagnostics nodeBuiltinImport:off -- This adapter owns the inherited native-control pipe.
import * as NodeStream from "@effect/platform-node/NodeStream";
import {
  RemoteDesktopError,
  RemoteDesktopNativeEvent,
  RemoteDesktopNativeRequest,
  type RemoteDesktopNativeCommand,
  type RemoteDesktopNativeResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Ndjson from "effect/encoding/Ndjson";
import * as NodeNet from "node:net";

import * as ServerConfig from "../config.ts";
import { writeAllToFileDescriptor } from "../resourceTelemetry/DesktopTelemetryReceiver.ts";

export class NativeControlWriteError extends Schema.TaggedError<NativeControlWriteError>()(
  "RemoteDesktopNativeControlWriteError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not write native remote desktop control data.";
  }
}
export type NativeFailure = RemoteDesktopError | NativeControlWriteError;
export class NativeChannel extends Context.Service<
  NativeChannel,
  {
    readonly available: boolean;
    readonly request: (
      command: RemoteDesktopNativeCommand,
    ) => Effect.Effect<RemoteDesktopNativeResult, NativeFailure>;
    readonly subscribe: Effect.Effect<Stream.Stream<RemoteDesktopNativeEvent>, never, Scope.Scope>;
  }
>()("t3/remoteDesktop/NativeChannel") {}

const decode = Schema.decodeUnknownOption(RemoteDesktopNativeEvent);
const encode = Schema.encodeSync(Schema.fromJsonString(RemoteDesktopNativeRequest));

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const inputFd = config.desktopRemoteDesktopFd;
  const outputFd = config.desktopRemoteDesktopControlFd;
  if (inputFd === undefined || outputFd === undefined) {
    return NativeChannel.of({
      available: false,
      subscribe: Effect.succeed(Stream.empty),
      request: Effect.fn("RemoteDesktopNative.request")(function () {
        return Effect.fail(new RemoteDesktopError({ reason: "unavailable" }));
      }),
    });
  }
  const outbox = yield* PubSub.bounded<RemoteDesktopNativeEvent>(64);
  const pending = new Map<
    string,
    Deferred.Deferred<RemoteDesktopNativeResult, RemoteDesktopError>
  >();
  const lock = yield* Semaphore.make(1);
  let running = true;
  const unavailable = Effect.gen(function* () {
    if (!running) return;
    running = false;
    for (const reply of pending.values()) {
      yield* Deferred.fail(reply, new RemoteDesktopError({ reason: "unavailable" }));
    }
    pending.clear();
    yield* PubSub.publish(outbox, { type: "unavailable" });
  });
  const readable = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeNet.Socket({ fd: inputFd, readable: true, writable: false })),
    (socket) => Effect.sync(() => socket.destroy()),
  );
  yield* NodeStream.fromReadable<Uint8Array, Error>({
    evaluate: () => readable,
    closeOnDone: true,
    onError: () => new Error("Native remote desktop pipe closed"),
  }).pipe(
    Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
    Stream.runForEach((value) =>
      Effect.gen(function* () {
        const event = decode(value);
        if (Option.isNone(event)) return yield* unavailable;
        if (event.value.type === "reply") {
          const reply = pending.get(event.value.requestId);
          if (reply) yield* Deferred.succeed(reply, event.value.result);
        } else {
          yield* PubSub.publish(outbox, event.value);
        }
      }),
    ),
    Effect.ignoreCause,
    Effect.ensuring(unavailable),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      pending.values(),
      (reply) => Deferred.fail(reply, new RemoteDesktopError({ reason: "unavailable" })),
      { discard: true },
    ),
  );
  return NativeChannel.of({
    available: true,
    subscribe: PubSub.subscribe(outbox).pipe(Effect.map(Stream.fromSubscription)),
    request: Effect.fn("RemoteDesktopNative.request")(function* (command) {
      if (!running) return yield* new RemoteDesktopError({ reason: "unavailable" });
      if (pending.size >= 16) return yield* new RemoteDesktopError({ reason: "limit" });
      const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const reply = yield* Deferred.make<RemoteDesktopNativeResult, RemoteDesktopError>();
      pending.set(requestId, reply);
      return yield* lock
        .withPermits(1)(
          writeAllToFileDescriptor(
            outputFd,
            Buffer.from(encode({ requestId, command }) + "\n"),
          ).pipe(Effect.mapError((cause) => new NativeControlWriteError({ cause }))),
        )
        .pipe(
          Effect.andThen(Deferred.await(reply)),
          Effect.timeoutOrElse({
            duration: "20 seconds",
            orElse: () => Effect.fail(new RemoteDesktopError({ reason: "transport" })),
          }),
          Effect.ensuring(
            Effect.sync(() => {
              pending.delete(requestId);
            }),
          ),
        );
    }),
  });
});
export const layer = Layer.effect(NativeChannel, make);
