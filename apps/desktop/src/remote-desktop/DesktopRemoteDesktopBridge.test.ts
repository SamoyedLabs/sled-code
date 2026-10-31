import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { RemoteDesktopNativeEvent, type RemoteDesktopNativeRequest } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Bridge from "./DesktopRemoteDesktopBridge.ts";

const native = vi.hoisted(() => ({
  listeners: new Set<(event: RemoteDesktopNativeEvent) => void>(),
  commands: [] as RemoteDesktopNativeRequest[],
}));
vi.mock("./RemoteDesktopHost.ts", () => ({
  observeRemoteDesktopNative: (listener: (event: RemoteDesktopNativeEvent) => void) => {
    native.listeners.add(listener);
    return () => {
      native.listeners.delete(listener);
    };
  },
  sendRemoteDesktopNative: (request: RemoteDesktopNativeRequest) => {
    native.commands.push(request);
  },
}));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(RemoteDesktopNativeEvent));
const emit = (event: RemoteDesktopNativeEvent) => {
  for (const listener of native.listeners) listener(event);
};
const requestId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const start = (n: number): RemoteDesktopNativeRequest => ({
  requestId: requestId(n),
  command: {
    type: "start",
    sessionId: requestId(n + 100),
    clientNonce: requestId(n + 200),
    clientFingerprint: "A".repeat(43),
    hostFingerprint: "B".repeat(43),
    offer: "v=0\r\n",
    expiresAt: 30_000,
  },
});
const setup = Effect.fn("RemoteDesktopBridgeTest.setup")(function* () {
  native.commands.length = 0;
  const context = yield* Layer.build(Bridge.layer.pipe(Layer.provide(NodeCrypto.layer)));
  return Context.get(context, Bridge.DesktopRemoteDesktopBridge);
});
const next = Effect.fn("RemoteDesktopBridgeTest.next")(function* (
  stream: Stream.Stream<Uint8Array>,
) {
  const chunks = yield* stream.pipe(Stream.take(1), Stream.runCollect);
  return decode(new TextDecoder().decode(chunks[0]).trim());
});

describe("private remote desktop pipe ownership", () => {
  it.effect("bounds a silent helper's request lifetime and releases its pending admission", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const source = yield* bridge.open("backend-a");
      const request = start(1);
      yield* source.handleCommandLine(JSON.stringify(request));
      yield* TestClock.adjust("15 seconds");
      expect(yield* next(source.events)).toMatchObject({
        type: "reply",
        requestId: request.requestId,
        result: { reason: "transport" },
      });
      expect(
        native.commands.some(
          (entry) => entry.command.type === "stop" && entry.command.sessionId === requestId(101),
        ),
      ).toBe(true);
    }).pipe(Effect.scoped),
  );
  it.effect("buffers an immediate native reply before the backend starts reading", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const source = yield* bridge.open("backend-a");
      const request: RemoteDesktopNativeRequest = {
        requestId: requestId(1),
        command: { type: "status" },
      };
      yield* source.handleCommandLine(JSON.stringify(request));
      emit({
        type: "reply",
        requestId: request.requestId,
        result: { type: "error", reason: "disabled" },
      });
      expect(yield* next(source.events)).toMatchObject({
        type: "reply",
        requestId: request.requestId,
      });
    }).pipe(Effect.scoped),
  );
  it.effect("rejects cross-backend renewal, restart and close before reaching the helper", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const a = yield* bridge.open("backend-a");
      const b = yield* bridge.open("backend-b");
      const original = start(1);
      yield* a.handleCommandLine(JSON.stringify(original));
      expect(original.command.type).toBe("start");
      if (original.command.type !== "start") return;
      for (const type of ["renew", "restart", "stop"] as const) {
        yield* b.handleCommandLine(
          JSON.stringify({
            requestId: requestId(type === "renew" ? 2 : type === "restart" ? 3 : 4),
            command: {
              ...original.command,
              type,
              sessionId: original.command.sessionId,
              expiresAt: 40_000,
              connectivity: {
                iceServers: [],
                expiresAt: 3_600_000,
                relayOnly: false,
                relayAvailable: false,
              },
            },
          }),
        );
        expect(yield* next(b.events)).toMatchObject({
          type: "reply",
          result: { type: "error", reason: "not_found" },
        });
      }
      expect(native.commands).toEqual([original]);
    }).pipe(Effect.scoped),
  );
  it.effect("releases only a stopped backend's native sessions", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const aScope = yield* Scope.make();
      const a = yield* bridge.open("backend-a").pipe(Scope.provide(aScope));
      const b = yield* bridge.open("backend-b");
      const first = start(1),
        second = start(2);
      yield* a.handleCommandLine(JSON.stringify(first));
      yield* b.handleCommandLine(JSON.stringify(second));
      yield* Scope.close(aScope, Exit.void);
      expect(
        native.commands
          .filter((request) => request.command.type === "stop")
          .map((request) => (request.command.type === "stop" ? request.command.sessionId : null)),
      ).toEqual([requestId(101)]);
      emit({
        type: "reply",
        requestId: first.requestId,
        result: { type: "error", reason: "disabled" },
      });
      emit({
        type: "reply",
        requestId: second.requestId,
        result: { type: "error", reason: "disabled" },
      });
      expect(yield* next(b.events)).toMatchObject({ type: "reply", requestId: second.requestId });
    }).pipe(Effect.scoped),
  );
  it.effect("bounds outstanding helper requests for each backend", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const source = yield* bridge.open("backend-a");
      for (let n = 1; n <= 17; n++) {
        yield* source.handleCommandLine(
          JSON.stringify({ requestId: requestId(n), command: { type: "status" } }),
        );
      }
      expect(native.commands).toHaveLength(16);
      expect(yield* next(source.events)).toMatchObject({
        type: "reply",
        requestId: requestId(17),
        result: { reason: "limit" },
      });
    }).pipe(Effect.scoped),
  );
  it.effect("routes helper closure only to its owning backend", () =>
    Effect.gen(function* () {
      const bridge = yield* setup();
      const a = yield* bridge.open("backend-a"),
        b = yield* bridge.open("backend-b");
      const first = start(1);
      yield* a.handleCommandLine(JSON.stringify(first));
      emit({ type: "closed", sessionId: requestId(101) });
      expect(yield* next(a.events)).toEqual({ type: "closed", sessionId: requestId(101) });
      yield* b.handleCommandLine(
        JSON.stringify({ requestId: requestId(2), command: { type: "status" } }),
      );
      emit({
        type: "reply",
        requestId: requestId(2),
        result: { type: "error", reason: "disabled" },
      });
      expect(yield* next(b.events)).toMatchObject({ type: "reply", requestId: requestId(2) });
    }).pipe(Effect.scoped),
  );
});
