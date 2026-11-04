import {
  OpenbotEventRoutine,
  OpenbotRoutineRun,
  OpenbotEventActivity,
  OpenbotEventReceipt,
  type OpenbotEventAdminRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class RoutineResponseError extends Schema.TaggedError<RoutineResponseError>()(
  "OpenbotRoutineResponseError",
  {},
) {
  override get message() {
    return "The engine returned an unsupported routine response.";
  }
}
type Request = OpenbotEventAdminRequest;
const paths: Readonly<Record<Request["operation"], string>> = {
  "events.status": "/v1/admin/events/status",
  "events.list": "/v1/admin/routine-recovery/routines/list",
  "events.save": "/v1/admin/routine-recovery/routines/save",
  "events.delete": "/v1/admin/events/routines/delete",
  "events.test": "/v1/admin/events/routines/test",
  "events.rotateSecret": "/v1/admin/events/routines/rotate-secret",
  "events.sendTest": "/v1/admin/webhook-tests/send",
  "events.activity": "/v1/admin/events/activity",
  "events.runs": "/v1/admin/routine-recovery/runs",
};
export function isRequest(input: { readonly operation: string }): input is Request {
  return Object.hasOwn(paths, input.operation);
}
export function route(request: Request) {
  const { operation, ...body } = request;
  return { method: "POST" as const, path: paths[operation], body, eventProjection: operation };
}
// Future fields survive validation; reserved configuration keys never enter general read results.
export function publicRoutineJson(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) return value.map(publicRoutineJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        ["url", "webhookUrl", "secret"].includes(key) ? null : publicRoutineJson(entry),
      ]),
    );
  return value;
}
const schemas = {
  "events.status": Schema.Struct({ supported: Schema.Boolean, connected: Schema.Boolean }),
  "events.list": Schema.Array(OpenbotEventRoutine).check(Schema.isMaxLength(10000)),
  "events.save": Schema.Struct({
    routine: OpenbotEventRoutine,
    secret: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
  }),
  "events.delete": Schema.Struct({}),
  "events.test": Schema.Struct({}),
  "events.rotateSecret": Schema.Struct({ secret: Schema.String.check(Schema.isMaxLength(1024)) }),
  "events.sendTest": OpenbotEventReceipt,
  "events.activity": Schema.Array(OpenbotEventActivity).check(Schema.isMaxLength(10000)),
  "events.runs": Schema.Array(OpenbotRoutineRun).check(Schema.isMaxLength(100)),
};
const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
const decoders = {
  "events.status": Schema.decodeUnknownEffect(schemas["events.status"]),
  "events.list": Schema.decodeUnknownEffect(schemas["events.list"]),
  "events.save": Schema.decodeUnknownEffect(schemas["events.save"]),
  "events.delete": Schema.decodeUnknownEffect(schemas["events.delete"]),
  "events.test": Schema.decodeUnknownEffect(schemas["events.test"]),
  "events.rotateSecret": Schema.decodeUnknownEffect(schemas["events.rotateSecret"]),
  "events.sendTest": Schema.decodeUnknownEffect(schemas["events.sendTest"]),
  "events.activity": Schema.decodeUnknownEffect(schemas["events.activity"]),
  "events.runs": Schema.decodeUnknownEffect(schemas["events.runs"]),
};
export const project = Effect.fn("OpenbotEventProtocol.project")(
  function* (operation: Request["operation"], value: unknown) {
    yield* decoders[operation](value);
    const json = yield* decodeJson(value);
    return operation === "events.save" || operation === "events.rotateSecret"
      ? json
      : publicRoutineJson(json);
  },
  Effect.mapError(() => new RoutineResponseError({})),
);
