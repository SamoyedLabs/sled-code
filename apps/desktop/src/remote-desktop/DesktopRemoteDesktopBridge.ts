import { RemoteDesktopNativeRequest, RemoteDesktopNativeEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { observeRemoteDesktopNative, sendRemoteDesktopNative } from "./RemoteDesktopHost.ts";

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(RemoteDesktopNativeRequest));
const encode = Schema.encodeSync(Schema.fromJsonString(RemoteDesktopNativeEvent));
interface Source {
  readonly outbox: Queue.Queue<Uint8Array>;
  readonly pending: Set<string>;
  readonly sessions: Set<string>;
}
export class DesktopRemoteDesktopBridge extends Context.Service<
  DesktopRemoteDesktopBridge,
  {
    readonly open: (sourceId: string) => Effect.Effect<
      {
        readonly events: Stream.Stream<Uint8Array>;
        readonly handleCommandLine: (line: string) => Effect.Effect<void>;
      },
      never,
      Scope.Scope
    >;
  }
>()("@t3tools/desktop/remote-desktop/DesktopRemoteDesktopBridge") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sources = new Map<string, Source>();
  const requests = new Map<
    string,
    { sourceId: string; request: RemoteDesktopNativeRequest; done: Deferred.Deferred<void> }
  >();
  const owners = new Map<string, string>();
  const encoder = new TextEncoder();
  const scope = yield* Scope.Scope;
  const emit = Effect.fn("DesktopRemoteDesktopBridge.emit")(function* (
    sourceId: string,
    event: RemoteDesktopNativeEvent,
  ) {
    const source = sources.get(sourceId);
    if (source) yield* Queue.offer(source.outbox, encoder.encode(encode(event) + "\n"));
  });
  const receive = Effect.fn("DesktopRemoteDesktopBridge.receive")(function* (
    event: RemoteDesktopNativeEvent,
  ) {
    if (event.type === "reply") {
      const pending = requests.get(event.requestId);
      if (!pending) return;
      requests.delete(event.requestId);
      yield* Deferred.succeed(pending.done, undefined);
      const source = sources.get(pending.sourceId);
      source?.pending.delete(event.requestId);
      const command = pending.request.command;
      if ((event.result.type === "error" && command.type === "start") || command.type === "stop") {
        owners.delete(command.sessionId);
        source?.sessions.delete(command.sessionId);
      }
      yield* emit(pending.sourceId, event);
    } else if (event.type === "closed") {
      const sourceId = owners.get(event.sessionId);
      if (sourceId === undefined) return;
      owners.delete(event.sessionId);
      sources.get(sourceId)?.sessions.delete(event.sessionId);
      yield* emit(sourceId, event);
    } else {
      owners.clear();
      const finished = [...requests.values()];
      const waiting = [...sources].map(([sourceId, source]) => ({
        sourceId,
        requests: [...source.pending],
      }));
      requests.clear();
      for (const source of sources.values()) {
        source.sessions.clear();
        source.pending.clear();
      }
      for (const pending of finished) yield* Deferred.succeed(pending.done, undefined);
      for (const { sourceId, requests: waitingIds } of waiting) {
        for (const requestId of waitingIds) {
          yield* emit(sourceId, {
            type: "reply",
            requestId,
            result: { type: "error", reason: "unavailable" },
          });
        }
        yield* emit(sourceId, event);
      }
    }
  });
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      observeRemoteDesktopNative((event) => {
        runFork(receive(event));
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  return DesktopRemoteDesktopBridge.of({
    open: Effect.fn("DesktopRemoteDesktopBridge.open")(function* (sourceId) {
      if (sources.has(sourceId))
        return yield* Effect.die(new Error("Remote desktop source is already registered."));
      const source: Source = {
        outbox: yield* Queue.bounded<Uint8Array>(32),
        pending: new Set(),
        sessions: new Set(),
      };
      sources.set(sourceId, source);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (sources.get(sourceId) !== source) return;
          sources.delete(sourceId);
          for (const requestId of source.pending) {
            const pending = requests.get(requestId);
            requests.delete(requestId);
            if (pending) yield* Deferred.succeed(pending.done, undefined);
          }
          for (const sessionId of source.sessions) {
            owners.delete(sessionId);
            const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
            yield* Effect.sync(() =>
              sendRemoteDesktopNative({ requestId, command: { type: "stop", sessionId } }),
            );
          }
          yield* Queue.shutdown(source.outbox);
        }),
      );
      return {
        events: Stream.fromQueue(source.outbox),
        handleCommandLine: Effect.fn("DesktopRemoteDesktopBridge.command")(function* (
          line: string,
        ) {
          if (sources.get(sourceId) !== source || line.length > 256 * 1024) return;
          const decoded = decode(line);
          if (Option.isNone(decoded)) return;
          const request = decoded.value;
          const command = request.command;
          const done = yield* Deferred.make<void>();
          if (source.pending.size >= 16 || requests.size >= 64 || requests.has(request.requestId)) {
            return yield* emit(sourceId, {
              type: "reply",
              requestId: request.requestId,
              result: { type: "error", reason: "limit" },
            });
          }
          if (command.type !== "status") {
            const owner = owners.get(command.sessionId);
            if (owner !== undefined && owner !== sourceId) {
              return yield* emit(sourceId, {
                type: "reply",
                requestId: request.requestId,
                result: { type: "error", reason: "not_found" },
              });
            }
            if (command.type === "start") {
              if (owners.size >= 8 || owner !== undefined) {
                return yield* emit(sourceId, {
                  type: "reply",
                  requestId: request.requestId,
                  result: { type: "error", reason: "limit" },
                });
              }
              owners.set(command.sessionId, sourceId);
              source.sessions.add(command.sessionId);
            } else if (
              (command.type === "renew" || command.type === "restart") &&
              owner === undefined
            ) {
              return yield* emit(sourceId, {
                type: "reply",
                requestId: request.requestId,
                result: { type: "error", reason: "not_found" },
              });
            }
          }
          source.pending.add(request.requestId);
          requests.set(request.requestId, { sourceId, request, done });
          yield* Deferred.await(done).pipe(
            Effect.timeoutOrElse({
              duration: "15 seconds",
              orElse: Effect.fn("DesktopRemoteDesktopBridge.timeout")(function* () {
                if (requests.get(request.requestId)?.done !== done) return;
                requests.delete(request.requestId);
                source.pending.delete(request.requestId);
                if (command.type === "start" || command.type === "restart") {
                  owners.delete(command.sessionId);
                  source.sessions.delete(command.sessionId);
                  const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
                  yield* Effect.sync(() =>
                    sendRemoteDesktopNative({
                      requestId,
                      command: { type: "stop", sessionId: command.sessionId },
                    }),
                  );
                }
                yield* emit(sourceId, {
                  type: "reply",
                  requestId: request.requestId,
                  result: { type: "error", reason: "transport" },
                });
              }),
            }),
            Effect.forkIn(scope),
          );
          yield* Effect.sync(() => sendRemoteDesktopNative(request));
        }),
      };
    }),
  });
});
export const layer = Layer.effect(DesktopRemoteDesktopBridge, make);
