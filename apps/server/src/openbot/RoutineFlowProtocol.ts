import {
  OpenbotRoutineFlowCanvas,
  OpenbotRoutineFlowLink,
  type OpenbotRoutineFlowReadRequest,
  type OpenbotRoutineFlowCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { publicRoutineJson, RoutineResponseError } from "./EventProtocol.ts";
type Request = OpenbotRoutineFlowReadRequest | OpenbotRoutineFlowCommand;
const paths: Readonly<Record<Request["operation"], string>> = {
  "routineFlow.canvas": "canvas",
  "routineFlow.savePosition": "positions/save",
  "routineFlow.removePosition": "positions/remove",
  "routineFlow.connect": "links/connect",
  "routineFlow.disconnect": "links/disconnect",
  "routineFlow.updateLink": "links/update",
};
export function isRequest(input: { readonly operation: string }): input is Request {
  return Object.hasOwn(paths, input.operation);
}
export function route(request: Request) {
  const { operation, ...body } = request;
  return {
    method: "POST" as const,
    path: `/v1/routine-flows/${paths[operation]}`,
    body,
    routineFlowProjection: operation,
  };
}
const decodeCanvas = Schema.decodeUnknownEffect(OpenbotRoutineFlowCanvas);
const decodeLink = Schema.decodeUnknownEffect(OpenbotRoutineFlowLink);
const decodeEmpty = Schema.decodeUnknownEffect(Schema.Struct({}));
const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotRoutineFlowProtocol.project")(
  function* (operation: Request["operation"], value: unknown) {
    const decode =
      operation === "routineFlow.canvas"
        ? decodeCanvas
        : operation === "routineFlow.connect" || operation === "routineFlow.updateLink"
          ? decodeLink
          : decodeEmpty;
    yield* decode(value);
    return publicRoutineJson(yield* decodeJson(value));
  },
  Effect.mapError(() => new RoutineResponseError({})),
);
