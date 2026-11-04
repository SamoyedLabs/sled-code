import type { OpenbotComputerViewCommand, OpenbotComputerViewerGrant } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import * as Scope from "effect/Scope";
import * as Queue from "effect/Queue";
import { WebSocket } from "@effect/platform-node/NodeWS";
import { ComputerViews } from "./ComputerViews.ts";
import type { ComputerSession } from "./ComputerViewSession.ts";

export class ComputerViewError extends Schema.TaggedError<ComputerViewError>()(
  "ComputerViewError",
  {
    reason: Schema.Literals(["unavailable", "transport"]),
  },
) {
  override get message() {
    return "The computer session is unavailable or expired.";
  }
}
export class ComputerViewHost extends Context.Service<
  ComputerViewHost,
  {
    readonly authorize: (principal: string, hostId: string) => Promise<void>;
    readonly create: (hostId: string) => Promise<ComputerSession>;
    readonly watch: (invalidate: () => Promise<void>) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/openbot/ComputerViewGateway/ComputerViewHost") {}
export class ComputerViewGateway extends Context.Service<
  ComputerViewGateway,
  {
    readonly command: (
      principal: string,
      input: OpenbotComputerViewCommand,
    ) => Effect.Effect<OpenbotComputerViewerGrant | null, ComputerViewError>;
    readonly views: ComputerViews;
    readonly connect: (
      id: string,
      cookie: string,
    ) => Effect.Effect<
      {
        run: (
          socket: Socket.Socket,
          bufferedBytes: () => number,
        ) => Effect.Effect<void, ComputerViewError, Scope.Scope>;
      },
      ComputerViewError,
      Scope.Scope
    >;
  }
>()("t3/openbot/ComputerViewGateway") {}
const make = Effect.gen(function* () {
  const host = yield* ComputerViewHost;
  const views = new ComputerViews(host);
  yield* Effect.addFinalizer(() => Effect.promise(() => views.stop()).pipe(Effect.ignore));
  yield* host.watch(() => views.sweep());
  const connect = Effect.fn("ComputerViewGateway.connect")(function* (id: string, cookie: string) {
    const entry = yield* Effect.tryPromise({
      try: () => views.access(id, cookie),
      catch: () => new ComputerViewError({ reason: "unavailable" }),
    });
    const upstream = yield* Effect.try({
      try: () => entry.session.dial(),
      catch: () => new ComputerViewError({ reason: "transport" }),
    });
    const output = yield* Queue.bounded<string | Uint8Array | null, ComputerViewError>(32);
    let pending = 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      upstream.close(1000, "Computer session ended");
      Queue.failCauseUnsafe(output, Cause.fail(new ComputerViewError({ reason: "transport" })));
    };
    entry.stops.add(stop);
    const receive = (data: import("@effect/platform-node/NodeWS").RawData, binary: boolean) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      pending += bytes.byteLength;
      if (
        pending > 4 * 1024 * 1024 ||
        !Queue.offerUnsafe(output, binary ? bytes : bytes.toString("utf8"))
      )
        stop();
    };
    upstream.on("message", receive);
    upstream.once("close", stop);
    upstream.once("error", stop);
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        entry.stops.delete(stop);
        upstream.off("message", receive);
        upstream.off("close", stop);
        upstream.off("error", stop);
        // Closing a pending handshake emits an asynchronous error after listeners detach.
        upstream.once("error", () => {});
        upstream.close();
        await views.close(entry.principal, entry.hostId, id);
      }).pipe(Effect.ignore),
    );
    yield* Effect.callback<void, ComputerViewError>((resume) => {
      if (upstream.readyState === WebSocket.OPEN) {
        resume(Effect.void);
        return;
      }
      if (upstream.readyState !== WebSocket.CONNECTING) {
        resume(Effect.fail(new ComputerViewError({ reason: "transport" })));
        return;
      }
      const opened = () => resume(Effect.void);
      const failed = () => resume(Effect.fail(new ComputerViewError({ reason: "transport" })));
      upstream.once("open", opened);
      upstream.once("error", failed);
      upstream.once("close", failed);
      return Effect.sync(() => {
        upstream.off("open", opened);
        upstream.off("error", failed);
        upstream.off("close", failed);
      });
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(() => new ComputerViewError({ reason: "transport" })),
    );
    return {
      run: Effect.fn("ComputerViewGateway.stream")(
        function* (socket: Socket.Socket, bufferedBytes: () => number) {
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          const check = Effect.tryPromise({
            try: () => views.access(id, cookie),
            catch: () => new ComputerViewError({ reason: "unavailable" }),
          });
          const send = Queue.take(output).pipe(
            Effect.flatMap((value) =>
              Effect.gen(function* () {
                if (value === null || bufferedBytes() > 4 * 1024 * 1024)
                  return yield* new ComputerViewError({ reason: "transport" });
                yield* check;
                pending -= typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
                yield* writer.write(value);
              }),
            ),
          );
          const input = reader.pull.pipe(
            Effect.flatMap((chunks) =>
              Effect.forEach(
                chunks,
                (chunk) =>
                  Effect.gen(function* () {
                    yield* check;
                    if (
                      (typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength) >
                        1024 * 1024 + 69 ||
                      upstream.readyState !== WebSocket.OPEN ||
                      upstream.bufferedAmount > 4 * 1024 * 1024
                    )
                      return yield* new ComputerViewError({ reason: "transport" });
                    upstream.send(chunk);
                  }),
                { discard: true },
              ),
            ),
          );
          return yield* Effect.raceFirst(Effect.forever(send), Effect.forever(input));
        },
        Effect.mapError(() => new ComputerViewError({ reason: "transport" })),
      ),
    };
  });
  const command = Effect.fn("ComputerViewGateway.command")(
    (principal: string, input: OpenbotComputerViewCommand) =>
      Effect.tryPromise({
        try: () =>
          input.operation === "open"
            ? views.open(principal, input.hostId, input.frameOrigin)
            : views.close(principal, input.hostId, input.id).then(() => null),
        catch: () => new ComputerViewError({ reason: "unavailable" }),
      }),
  );
  return ComputerViewGateway.of({ command, views, connect });
});
export const layer = Layer.effect(ComputerViewGateway, make);
