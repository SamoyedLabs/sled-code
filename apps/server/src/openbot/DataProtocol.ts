import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import {
  OpenbotSharedTables,
  OpenbotHostedSites,
  OpenbotDataReadRequest,
  OpenbotDataAdminRequest,
} from "@t3tools/contracts";

type Request = OpenbotDataReadRequest | OpenbotDataAdminRequest;
export function isRequest(request: { readonly operation: string }): request is Request {
  return ["tables.list", "tables.delete", "sites.list", "sites.delete"].includes(request.operation);
}
export function route(request: Request) {
  const path =
    request.operation === "tables.list"
      ? "/v1/admin/shared-tables/list"
      : request.operation === "tables.delete"
        ? "/v1/admin/shared-tables/delete"
        : request.operation === "sites.list"
          ? "/v1/hosted-sites/list"
          : "/v1/hosted-sites/delete";
  const body =
    request.operation === "tables.delete"
      ? { name: request.name }
      : request.operation === "sites.delete"
        ? { siteId: request.siteId }
        : {};
  return { method: "POST" as const, path, body, dataProjection: request.operation };
}
const decodeEmpty = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
export const project = Effect.fn("OpenbotDataProtocol.project")((
  operation: Request["operation"],
  value: unknown,
) => {
  if (operation === "tables.delete" || operation === "sites.delete")
    return decodeEmpty(value).pipe(Effect.as({}));
  const schema: Schema.Codec<unknown> =
    operation === "tables.list"
      ? OpenbotSharedTables
      : operation === "sites.list"
        ? OpenbotHostedSites
        : Schema.Struct({});
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
  );
});
export class DataError extends Schema.TaggedError<DataError>()("OpenbotDataError", {
  operation: Schema.Literals(["tables.list", "tables.delete", "sites.list", "sites.delete"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return "The shared data request failed. Check host capabilities, account and permissions before retrying.";
  }
}
// The authenticated host connection owns this port; no URL, credential or generic route is public.
export class DataHost extends Context.Service<
  DataHost,
  {
    readonly request: (input: Request) => Effect.Effect<unknown, DataError>;
  }
>()("t3/openbot/DataProtocol/DataHost") {}
export class Data extends Context.Service<
  Data,
  {
    readonly execute: (input: Request) => Effect.Effect<Schema.Json, DataError>;
  }
>()("t3/openbot/DataProtocol/Data") {}
const decodeRequest = Schema.decodeUnknownEffect(
  Schema.Union([OpenbotDataReadRequest, OpenbotDataAdminRequest]),
);
export const layer = Layer.effect(
  Data,
  Effect.gen(function* () {
    const host = yield* DataHost;
    const execute = Effect.fn("OpenbotData.execute")(function* (input: Request) {
      const request = yield* decodeRequest(input).pipe(
        Effect.mapError((cause) => new DataError({ operation: input.operation, cause })),
      );
      const value = yield* host.request(request);
      return yield* project(input.operation, value).pipe(
        Effect.mapError((cause) => new DataError({ operation: input.operation, cause })),
      );
    });
    return Data.of({ execute });
  }),
);
