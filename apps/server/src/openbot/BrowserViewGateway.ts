import {
  AuthPreviewOperateScope,
  AuthSettingsWriteScope,
  AuthSessionId,
  type OpenbotBrowserViewCommand,
  type OpenbotBrowserViewerGrant,
  decodeBrowserViewFrame,
  browserViewInputForHost,
  decodeBrowserViewHostMessage,
  type OpenbotBrowserViewFeatures,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Socket from "effect/socket/Socket";
import { WebSocket } from "@effect/platform-node/NodeWS";
import * as SessionStore from "../auth/SessionStore.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import { decodeOpenbotBrowserViewerInput } from "@t3tools/contracts";
import { BrowserFrameDelivery, BrowserHeldInput } from "./BrowserProtocol.ts";
import { BrowserViews } from "./BrowserViews.ts";

const isTeamClientError = Schema.is(TeamClient.TeamClientError);

export class BrowserViewGatewayError extends Schema.TaggedError<BrowserViewGatewayError>()(
  "BrowserViewGatewayError",
  {
    reason: Schema.Literals(["authorization", "upstream", "transport"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return "The bot browser view is unavailable.";
  }
}
export class BrowserViewGateway extends Context.Service<
  BrowserViewGateway,
  {
    readonly command: (
      sessionId: AuthSessionId,
      input: OpenbotBrowserViewCommand,
    ) => Effect.Effect<OpenbotBrowserViewerGrant | null, BrowserViewGatewayError>;
    readonly connect: (
      sessionId: AuthSessionId,
      input: { hostId: string; id: string; token: string },
    ) => Effect.Effect<
      {
        readonly run: (
          socket: Socket.Socket,
          bufferedBytes: () => number,
        ) => Effect.Effect<void, BrowserViewGatewayError, Scope.Scope>;
      },
      BrowserViewGatewayError,
      Scope.Scope
    >;
  }
>()("t3/openbot/BrowserViewGateway") {}

const make = Effect.gen(function* () {
  const integration = yield* Integration.Integration;
  const repository = yield* AuthSessions.AuthSessionRepository;
  const sessions = yield* SessionStore.SessionStore;
  const clock = yield* Clock.Clock;
  const platform = yield* HostProcess.Platform;
  // Private HTTP/socket callbacks cross the Promise transport seam with the application context.
  const run = Effect.runPromiseWith(yield* Effect.context<never>());
  // Frame/input checks share the enclosing socket span instead of creating spans for every frame.
  const authorize = Effect.fnUntraced(function* (sessionId: AuthSessionId, hostId: string) {
    const row = yield* repository
      .getById({ sessionId })
      .pipe(
        Effect.mapError((cause) => new BrowserViewGatewayError({ reason: "authorization", cause })),
      );
    const now = yield* DateTime.now;
    if (
      Option.isNone(row) ||
      row.value.revokedAt !== null ||
      row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds ||
      ![AuthSettingsWriteScope, AuthPreviewOperateScope].every((scope) =>
        row.value.scopes.includes(scope),
      ) ||
      (yield* integration.readyHostId) !== hostId
    )
      return yield* new BrowserViewGatewayError({ reason: "authorization" });
  });
  const views = new BrowserViews({
    now: () => clock.currentTimeMillisUnsafe(),
    authorize: (principal, hostId) => run(authorize(AuthSessionId.make(principal), hostId)),
    create: (hostId, tabId, features) =>
      run(
        integration.withBrowserToHost(hostId, (session) =>
          Effect.tryPromise({
            try: () => session.create(tabId, features),
            catch: (cause) =>
              isTeamClientError(cause)
                ? cause
                : new TeamClient.TeamClientError({ reason: "transport", cause }),
          }).pipe(Effect.map((upstream) => ({ session, upstream }))),
        ),
      ),
  });
  yield* Effect.addFinalizer(() => Effect.promise(() => views.stop()).pipe(Effect.ignore));
  yield* Stream.merge(
    sessions.streamChanges.pipe(Stream.map(() => undefined)),
    integration.readyChanges.pipe(Stream.map(() => undefined)),
  ).pipe(
    Stream.runForEach(() => Effect.promise(() => views.sweep()).pipe(Effect.ignore)),
    Effect.forkScoped,
  );
  const requestError = (cause: unknown) =>
    new BrowserViewGatewayError({ reason: "upstream", cause });
  const encodeInput = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
  const command = Effect.fn("BrowserViewGateway.command")(function* (
    sessionId: AuthSessionId,
    input: OpenbotBrowserViewCommand,
  ) {
    yield* authorize(sessionId, input.hostId);
    let features: OpenbotBrowserViewFeatures | undefined;
    if (input.operation === "open" && (input.advanced || input.viewport)) {
      const support = yield* integration
        .apiReadToHost(input.hostId, { operation: "compatibility.read" })
        .pipe(Effect.mapError(requestError));
      const available =
        typeof support === "object" &&
        support !== null &&
        "capabilities" in support &&
        Array.isArray(support.capabilities)
          ? support.capabilities
          : [];
      if (input.viewport && !available.includes("browser-view-viewport"))
        return yield* requestError(
          new Error("This host does not support a requested browser viewport."),
        );
      features = {
        ...(input.viewport ? { viewport: input.viewport } : {}),
        framePoint: input.ackFrames === true && available.includes("browser-view-frame-point"),
        clipboard: available.includes("browser-view-clipboard"),
        cursor: available.includes("browser-view-cursor"),
        contextMenu: available.includes("browser-view-context-menu"),
        selectAllModifiers: platform === "darwin" ? 4 : 2,
      };
    }
    return yield* Effect.tryPromise({
      try: () =>
        input.operation === "open"
          ? views.open(sessionId, input.hostId, input.tabId, input.ackFrames, features)
          : views.close(sessionId, input.hostId, input.id).then(() => null),
      catch: requestError,
    });
  });
  const connect = Effect.fn("BrowserViewGateway.connect")(function* (
    sessionId: AuthSessionId,
    input: { hostId: string; id: string; token: string },
  ) {
    yield* authorize(sessionId, input.hostId);
    const upstream = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => views.connect(sessionId, input.hostId, input.id, input.token),
        catch: requestError,
      }),
      () =>
        Effect.tryPromise({
          try: () => views.close(sessionId, input.hostId, input.id),
          catch: requestError,
        }).pipe(Effect.ignore),
    );
    const delivery = new BrowserFrameDelivery(
      yield* Effect.tryPromise({
        try: () => views.acknowledgesFrames(sessionId, input.hostId, input.id),
        catch: requestError,
      }),
    );
    const features = yield* Effect.tryPromise({
      try: () => views.features(sessionId, input.hostId, input.id),
      catch: requestError,
    });
    const held = new BrowserHeldInput();
    const release = () => {
      const inputs = held.release();
      if (upstream.readyState === WebSocket.OPEN && upstream.bufferedAmount < 64 * 1024)
        for (const message of inputs) {
          try {
            upstream.send(JSON.stringify(message));
          } catch {
            break;
          }
        }
    };
    yield* Effect.tryPromise({
      try: () => views.beforeClose(sessionId, input.hostId, input.id, release),
      catch: requestError,
    });
    type Output =
      | { readonly _tag: "frame"; readonly bytes: Uint8Array }
      | { readonly _tag: "text"; readonly text: string }
      | { readonly _tag: "closed" };
    const output = yield* Queue.dropping<Output>(18);
    let newestFrame: Uint8Array | undefined;
    let frameQueued = false;
    let endedStream = false;
    const ended = () => {
      endedStream = true;
      Queue.offerUnsafe(output, { _tag: "closed" });
    };
    const offerFrame = (bytes: Uint8Array) => {
      newestFrame = bytes;
      if (!frameQueued) {
        frameQueued = true;
        if (!Queue.offerUnsafe(output, { _tag: "frame", bytes })) ended();
      }
    };
    const frame = (bytes: import("@effect/platform-node/NodeWS").RawData, binary: boolean) => {
      if (endedStream) return;
      if (!binary) {
        try {
          const text = Array.isArray(bytes)
            ? Buffer.concat(bytes).toString("utf8")
            : (bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes)).toString(
                "utf8",
              );
          const message = decodeBrowserViewHostMessage(text);
          if (
            message &&
            !Queue.offerUnsafe(output, { _tag: "text", text: JSON.stringify(message) })
          )
            ended();
        } catch {
          ended();
        }
        return;
      }
      try {
        const data = new Uint8Array(
          Array.isArray(bytes)
            ? Buffer.concat(bytes)
            : bytes instanceof ArrayBuffer
              ? bytes
              : new Uint8Array(bytes),
        );
        const frame = decodeBrowserViewFrame(data);
        const offered = delivery.offer(frame.sequence, data);
        if (offered) offerFrame(offered);
      } catch {
        ended();
      }
    };
    upstream.on("message", frame);
    upstream.once("close", ended);
    upstream.once("error", ended);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        release();
        upstream.off("message", frame);
        upstream.off("close", ended);
        upstream.off("error", ended);
        upstream.close(1000, "Browser view ended");
      }),
    );
    return {
      run: Effect.fn("BrowserViewGateway.stream")(
        function* (socket: Socket.Socket, bufferedBytes: () => number) {
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          const check = Effect.tryPromise({
            try: () => views.check(sessionId, input.hostId, input.id),
            catch: requestError,
          });
          const sendOutput = Queue.take(output).pipe(
            Effect.flatMap((value) =>
              Effect.gen(function* () {
                if (value._tag === "closed" || endedStream)
                  return yield* new BrowserViewGatewayError({ reason: "transport" });
                const data = value._tag === "text" ? value.text : newestFrame;
                if (value._tag === "frame") {
                  frameQueued = false;
                  newestFrame = undefined;
                }
                if (
                  data === undefined ||
                  bufferedBytes() +
                    (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength) >
                    4 * 1024 * 1024
                )
                  return yield* new BrowserViewGatewayError({ reason: "transport" });
                yield* check;
                yield* writer.write(data);
              }),
            ),
          );
          // Serial input shares the socket span and cannot grow a separate application queue.
          const receive = Effect.fnUntraced(function* (chunk: Uint8Array | string) {
            if (typeof chunk !== "string" || Buffer.byteLength(chunk) > 604096)
              return yield* new BrowserViewGatewayError({ reason: "transport" });
            const message = yield* Effect.try({
              try: () => decodeOpenbotBrowserViewerInput(chunk),
              catch: (cause) => new BrowserViewGatewayError({ reason: "transport", cause }),
            });
            yield* check;
            if (message.type === "release") {
              release();
              return;
            }
            if (message.type === "ack") {
              const previous = delivery.drawnSequence;
              const bytes = delivery.acknowledge(message.sequence);
              if (features?.framePoint && delivery.drawnSequence !== previous) {
                const packet = yield* encodeInput(message);
                yield* Effect.try({ try: () => upstream.send(packet), catch: requestError });
              }
              if (bytes) offerFrame(bytes);
              return;
            }
            if (
              features?.framePoint &&
              message.type === "pointer" &&
              (message.sequence === undefined || message.sequence !== delivery.drawnSequence)
            )
              return;
            const wire = browserViewInputForHost(
              message,
              features?.framePoint === true,
              features?.clipboard === true,
            );
            if (!wire) return;
            if (upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount >= 8192)
              return yield* new BrowserViewGatewayError({ reason: "transport" });
            yield* Effect.try({ try: () => held.record(wire), catch: requestError });
            const packet = yield* encodeInput(wire);
            yield* Effect.try({ try: () => upstream.send(packet), catch: requestError });
          });
          const receiveInput = reader.pull.pipe(
            Effect.flatMap((chunks) => Effect.forEach(chunks, receive, { discard: true })),
          );
          yield* Effect.raceFirst(
            Effect.raceFirst(Effect.forever(sendOutput), Effect.forever(receiveInput)),
            sessions
              .awaitInvalidation(sessionId)
              .pipe(
                Effect.andThen(
                  Effect.tryPromise({ try: () => views.revoke(sessionId), catch: requestError }),
                ),
              ),
          );
        },
        Effect.mapError((cause) => new BrowserViewGatewayError({ reason: "transport", cause })),
      ),
    };
  });
  return BrowserViewGateway.of({ command, connect });
});
export const layer = Layer.effect(BrowserViewGateway, make).pipe(Layer.provide(AuthSessions.layer));
