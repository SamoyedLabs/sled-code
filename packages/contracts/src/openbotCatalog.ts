import {
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import * as Schema from "effect/Schema";
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const Id = text(128).check(Schema.isMinLength(1));
const CustomId = text(40).check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));
export const OpenbotRegistryDistribution = Schema.Literals(["binary", "npx", "uvx"]);
export const OpenbotRegistryEntries = Schema.Array(
  Schema.Struct({
    id: Id,
    name: text(160),
    version: text(128),
    description: text(4096),
    website: Schema.NullOr(text(2048)),
    license: Schema.NullOr(text(128)),
    distributions: Schema.Array(OpenbotRegistryDistribution).check(Schema.isMaxLength(3)),
    installedVersion: Schema.NullOr(text(128)),
    customAgentId: Schema.NullOr(CustomId),
  }),
).check(Schema.isMaxLength(4096));
export const OpenbotRegistryInstalled = Schema.Array(
  Schema.Struct({
    registryId: Id,
    customAgentId: CustomId,
    version: text(128),
    distribution: OpenbotRegistryDistribution,
  }),
).check(Schema.isMaxLength(4096));
export const OpenbotRegistryStatus = Schema.Array(
  Schema.Struct({
    registryId: Id,
    state: Schema.Literals(["installing", "failed"]),
    message: Schema.NullOr(text(2048)),
  }),
).check(Schema.isMaxLength(4096));
export const OpenbotRegistryInstallResult = Schema.Struct({
  agents: Schema.Array(Schema.Struct({ id: CustomId, name: text(80) })).check(
    Schema.isMaxLength(256),
  ),
  restart: Schema.Literals(["restarted", "skipped-busy", "not-running"]),
});
export const OpenbotCatalogReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("registry.search"), query: text(256) }),
  Schema.Struct({ operation: Schema.Literal("registry.installed") }),
  Schema.Struct({ operation: Schema.Literal("registry.status") }),
]);
export const OpenbotCatalogAdminRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("registry.install"),
    registryId: Id,
    customAgentId: CustomId,
    name: Schema.optional(text(80)),
    distribution: Schema.optional(OpenbotRegistryDistribution),
  }),
  Schema.Struct({ operation: Schema.Literal("registry.cancel"), registryId: Id }),
  Schema.Struct({ operation: Schema.Literal("registry.remove"), registryId: Id }),
]);
export type OpenbotCatalogReadRequest = typeof OpenbotCatalogReadRequest.Type;
export type OpenbotCatalogAdminRequest = typeof OpenbotCatalogAdminRequest.Type;
export type OpenbotCatalogRequest = OpenbotCatalogReadRequest | OpenbotCatalogAdminRequest;
export type OpenbotRegistryEntry = (typeof OpenbotRegistryEntries.Type)[number];

export function catalogRequiredScopes(
  operation: unknown,
  kind: "read" | "admin",
): readonly AuthEnvironmentScope[] | null {
  const operations =
    kind === "read"
      ? ["registry.search", "registry.status", "registry.installed"]
      : ["registry.install", "registry.cancel", "registry.remove"];
  return typeof operation === "string" && operations.includes(operation)
    ? [AuthSettingsWriteScope, AuthProvidersManageScope]
    : null;
}
