import * as Schema from "effect/Schema";
const text = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));
const Id = text(128).check(Schema.isMinLength(1));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const OpenbotSharedTables = Schema.Array(
  Schema.Struct({
    name: text(256),
    ownerAgentId: Schema.NullOr(Id),
    rowCount: Schema.NullOr(Count),
  }),
).check(Schema.isMaxLength(10_000));
export type OpenbotSharedTables = typeof OpenbotSharedTables.Type;
export const OpenbotHostedSites = Schema.Struct({
  sites: Schema.Array(
    Schema.Struct({
      id: Id,
      hostname: text(253),
      url: text(2048),
      title: text(1024),
      description: text(4096),
      framework: Schema.Literals(["vanilla", "astro"]),
      status: Schema.Literals(["active", "deleted", "expired", "blocked"]),
      fileCount: Count,
      size: Count,
      expiresAt: Schema.NullOr(text(64)),
      updatedAt: text(64),
      serverId: Schema.NullOr(Id),
    }),
  ).check(Schema.isMaxLength(1000)),
  limit: Count,
  used: Count,
});
export type OpenbotHostedSites = typeof OpenbotHostedSites.Type;
export const OpenbotDataReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("tables.list") }),
  Schema.Struct({ operation: Schema.Literal("sites.list") }),
]);
export const OpenbotDataAdminRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("tables.delete"), name: text(256) }),
  Schema.Struct({ operation: Schema.Literal("sites.delete"), siteId: Id }),
]);
export type OpenbotDataReadRequest = typeof OpenbotDataReadRequest.Type;
export type OpenbotDataAdminRequest = typeof OpenbotDataAdminRequest.Type;
