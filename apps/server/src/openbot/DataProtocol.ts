import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import {
  OpenbotSharedTables,
  OpenbotHostedSites,
  OpenbotLibraryFiles,
  OpenbotLibraryFolders,
  OPENBOT_LIBRARY_ROUTES,
  OpenbotDataReadRequest,
  OpenbotDataAdminRequest,
  OpenbotLibraryReadRequest,
  OpenbotLibraryAdminRequest,
} from "@t3tools/contracts";

type Request =
  | OpenbotDataReadRequest
  | OpenbotDataAdminRequest
  | OpenbotLibraryReadRequest
  | OpenbotLibraryAdminRequest;
const paths = {
  "tables.list": "/v1/admin/shared-tables/list",
  "tables.delete": "/v1/admin/shared-tables/delete",
  "sites.list": "/v1/hosted-sites/list",
  "sites.delete": "/v1/hosted-sites/delete",
  "library.folders.read": OPENBOT_LIBRARY_ROUTES.read,
  "library.folders.change": OPENBOT_LIBRARY_ROUTES.change,
  "library.files.list": OPENBOT_LIBRARY_ROUTES.files,
  "library.files.delete": OPENBOT_LIBRARY_ROUTES.deleteFile,
} as const satisfies Record<Request["operation"], string>;

export function isRequest(request: { readonly operation: string }): request is Request {
  return Object.hasOwn(paths, request.operation);
}

export function route(request: Request) {
  const path = paths[request.operation];
  let body: unknown = {};
  switch (request.operation) {
    case "tables.delete":
      body = { name: request.name };
      break;
    case "sites.delete":
      body = { siteId: request.siteId };
      break;
    case "library.folders.change":
      body = request.action;
      break;
    case "library.files.delete":
      body = { fileId: request.fileId };
      break;
    case "library.files.list":
      body = { scope: "host", ...(request.force === undefined ? {} : { force: request.force }) };
      break;
  }
  return { method: "POST" as const, path, body, dataProjection: request.operation };
}

const projection = {
  "tables.list": OpenbotSharedTables,
  "sites.list": OpenbotHostedSites,
  "library.folders.read": OpenbotLibraryFolders,
  "library.folders.change": OpenbotLibraryFolders,
  "library.files.list": OpenbotLibraryFiles,
} satisfies Record<
  Exclude<Request["operation"], "tables.delete" | "sites.delete" | "library.files.delete">,
  Schema.Codec<unknown>
>;
const decodeEmpty = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));

export const project = Effect.fn("OpenbotDataProtocol.project")((
  operation: Request["operation"],
  value: unknown,
) => {
  if (
    operation === "tables.delete" ||
    operation === "sites.delete" ||
    operation === "library.files.delete"
  ) {
    return decodeEmpty(value).pipe(Effect.as({}));
  }
  const schema: Schema.Codec<unknown> = projection[operation];
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
  );
});
export class DataError extends Schema.TaggedError<DataError>()("OpenbotDataError", {
  operation: Schema.Literals([
    "tables.list",
    "tables.delete",
    "sites.list",
    "sites.delete",
    "library.folders.read",
    "library.folders.change",
    "library.files.list",
    "library.files.delete",
  ]),
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
  Schema.Union([
    OpenbotDataReadRequest,
    OpenbotDataAdminRequest,
    OpenbotLibraryReadRequest,
    OpenbotLibraryAdminRequest,
  ]),
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
