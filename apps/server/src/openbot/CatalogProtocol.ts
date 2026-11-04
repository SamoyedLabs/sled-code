import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  type OpenbotCatalogRequest,
  OpenbotRegistryEntries,
  OpenbotRegistryInstalled,
  OpenbotRegistryStatus,
  OpenbotRegistryInstallResult,
} from "@t3tools/contracts/openbot-catalog";
export function isRequest(request: {
  readonly operation: string;
}): request is OpenbotCatalogRequest {
  return [
    "registry.search",
    "registry.installed",
    "registry.status",
    "registry.install",
    "registry.cancel",
    "registry.remove",
  ].includes(request.operation);
}
export function route(request: OpenbotCatalogRequest) {
  const operation = request.operation;
  const paths = {
    "registry.search": "/v1/admin/acp-registry/search",
    "registry.installed": "/v1/admin/acp-registry/installed",
    "registry.status": "/v1/admin/acp-registry/status",
    "registry.install": "/v1/admin/acp-registry/install",
    "registry.cancel": "/v1/admin/acp-registry/cancel",
    "registry.remove": "/v1/admin/acp-registry/remove",
  } as const;
  const body =
    operation === "registry.search"
      ? { query: request.query }
      : operation === "registry.install"
        ? {
            registryId: request.registryId,
            customAgentId: request.customAgentId,
            ...(request.name === undefined ? {} : { name: request.name }),
            ...(request.distribution === undefined ? {} : { distribution: request.distribution }),
          }
        : operation === "registry.cancel" || operation === "registry.remove"
          ? { registryId: request.registryId }
          : {};
  return { method: "POST" as const, path: paths[operation], body, catalogProjection: operation };
}
const decodeEmpty = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
export const project = Effect.fn("OpenbotCatalogProtocol.project")((
  operation: OpenbotCatalogRequest["operation"],
  value: unknown,
) => {
  if (operation === "registry.cancel" || operation === "registry.remove")
    return decodeEmpty(value).pipe(Effect.as({}));
  const schema: Schema.Codec<unknown> =
    operation === "registry.search"
      ? OpenbotRegistryEntries
      : operation === "registry.installed"
        ? OpenbotRegistryInstalled
        : operation === "registry.status"
          ? OpenbotRegistryStatus
          : operation === "registry.install"
            ? OpenbotRegistryInstallResult
            : Schema.Struct({});
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
  );
});
