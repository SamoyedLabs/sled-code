// @effect-diagnostics nodeBuiltinImport:off - Loopback fixture holds the upstream websocket handshake.
import * as NodeHttp from "node:http";
import { WebSocket, WebSocketServer } from "@effect/platform-node/NodeWS";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Gateway from "./ComputerViewGateway.ts";
import type { ComputerSession } from "./ComputerViewSession.ts";

it.live("waits for the upstream handshake before accepting viewer traffic", () =>
  Effect.gen(function* () {
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const server = NodeHttp.createServer();
    const sockets = new Set<import("node:stream").Duplex>();
    const upstream = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      requested.resolve();
      void release.promise.then(() => {
        if (!socket.destroyed) upstream.handleUpgrade(request, socket, head, () => {});
      });
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        release.resolve();
        for (const socket of sockets) socket.destroy();
        upstream.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }),
    );
    yield* Effect.promise(
      () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    );
    const address = server.address();
    if (!address || typeof address === "string") return yield* Effect.die("No fixture address");
    const session: ComputerSession = {
      upstreamId: "private",
      target: "/moonlight/stream.html",
      isClosed: () => false,
      request: async () => {
        throw new Error("Unused fixture request");
      },
      test: async () => {
        throw new Error("Unused fixture test");
      },
      close: async () => {},
      dial: () => new WebSocket(`ws://127.0.0.1:${address.port}/stream`),
    };
    const program = Effect.gen(function* () {
      const gateway = yield* Gateway.ComputerViewGateway;
      const grant = yield* gateway.command("principal", {
        operation: "open",
        hostId: "host",
        frameOrigin: "self",
      });
      if (!grant) return yield* Effect.die("No viewer grant");
      const cookie = yield* Effect.promise(() => gateway.views.claim(grant.id, grant.ticket));
      const connecting = yield* gateway.connect(grant.id, cookie).pipe(Effect.forkScoped);
      yield* Effect.promise(() => requested.promise);
      expect(connecting.pollUnsafe()).toBeUndefined();
      release.resolve();
      yield* Fiber.join(connecting);
    });
    yield* program.pipe(
      Effect.provide(
        Gateway.layer.pipe(
          Layer.provide(
            Layer.succeed(Gateway.ComputerViewHost, {
              authorize: async () => {},
              create: async () => session,
              watch: () => Effect.void,
            }),
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped),
);
