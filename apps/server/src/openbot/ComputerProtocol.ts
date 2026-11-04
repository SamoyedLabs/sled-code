import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import {
  OpenbotComputerCapabilities,
  OpenbotComputerSetup,
  OpenbotComputerReadRequest,
  OpenbotComputerAdminRequest,
} from "@t3tools/contracts";

type Request = OpenbotComputerReadRequest | OpenbotComputerAdminRequest;
export function isRequest(request: { readonly operation: string }): request is Request {
  return (
    request.operation === "computer.capabilities" ||
    request.operation === "computer.setup" ||
    request.operation === "computer.display"
  );
}
export function route(request: Request) {
  switch (request.operation) {
    case "computer.capabilities":
      return {
        method: "GET" as const,
        path: "/v1/remote-screen/capabilities",
        computerProjection: request.operation,
      };
    case "computer.setup":
      return {
        method: "POST" as const,
        path: "/v1/remote-screen/setup",
        body: {},
        computerProjection: request.operation,
      };
    case "computer.display":
      return {
        method: "PUT" as const,
        path: "/v1/remote-screen/display",
        body: { displayId: request.displayId },
        computerProjection: request.operation,
      };
  }
}
export const project = Effect.fn("OpenbotComputerProtocol.project")((
  operation: Request["operation"],
  value: unknown,
) => {
  const schema: Schema.Codec<unknown> =
    operation === "computer.capabilities"
      ? OpenbotComputerCapabilities
      : operation === "computer.setup"
        ? OpenbotComputerSetup
        : Schema.Null;
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
  );
});
export class ComputerError extends Schema.TaggedError<ComputerError>()("OpenbotComputerError", {
  operation: Schema.Literals(["computer.capabilities", "computer.setup", "computer.display"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return "The computer request failed. Check host setup before retrying.";
  }
}
// The authenticated host connection owns this port; no URL, credential or generic route is public.
export class ComputerHost extends Context.Service<
  ComputerHost,
  {
    readonly request: (input: Request) => Effect.Effect<unknown, ComputerError>;
  }
>()("t3/openbot/ComputerProtocol/ComputerHost") {}
export class Computer extends Context.Service<
  Computer,
  {
    readonly execute: (input: Request) => Effect.Effect<Schema.Json, ComputerError>;
  }
>()("t3/openbot/ComputerProtocol/Computer") {}
const decodeRequest = Schema.decodeUnknownEffect(
  Schema.Union([OpenbotComputerReadRequest, OpenbotComputerAdminRequest]),
);
export const layer = Layer.effect(
  Computer,
  Effect.gen(function* () {
    const host = yield* ComputerHost;
    const execute = Effect.fn("OpenbotComputer.execute")(function* (input: Request) {
      const request = yield* decodeRequest(input).pipe(
        Effect.mapError((cause) => new ComputerError({ operation: input.operation, cause })),
      );
      const value = yield* host.request(request);
      return yield* project(input.operation, value).pipe(
        Effect.mapError((cause) => new ComputerError({ operation: input.operation, cause })),
      );
    });
    return Computer.of({ execute });
  }),
);
