import * as Schema from "effect/Schema";
import { OpenbotRoutineSchedule } from "./openbotEvents.ts";
import {
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthOrchestrationOperateScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const Id = text(128).check(Schema.isMinLength(1));
const Revision = text(64).check(Schema.isMinLength(1));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const TemplateSkill = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("marketplace"),
    skillId: text(256),
    versionId: text(256),
    slug: text(256),
    name: text(256),
    version: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("embedded"),
    slug: text(64),
    name: text(256),
    markdown: text(65536),
  }),
]);
const snapshot = {
  name: text(256),
  title: text(256),
  description: text(100000),
  skills: Schema.Array(TemplateSkill).check(Schema.isMaxLength(64)),
  routines: Schema.Array(
    Schema.Struct({
      name: text(256),
      instruction: text(100000),
      active: Schema.Boolean,
      schedule: OpenbotRoutineSchedule,
    }),
  ).check(Schema.isMaxLength(128)),
};
export const TemplatePublication = Schema.Struct({
  templateId: Id.check(Schema.isPattern(/^[A-Za-z0-9_-]{22}$/)),
  shareUrl: text(2048).check(
    Schema.isPattern(
      /^(?:https:\/\/openbot\.run|http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?)\/agents\/[A-Za-z0-9_-]{22}$/,
    ),
  ),
  publishedAt: Revision,
}).check(
  Schema.makeFilter((publication) =>
    publication.shareUrl.endsWith(`/agents/${publication.templateId}`),
  ),
);
export const TemplatePreview = Schema.Struct({
  ...snapshot,
  agentId: Id,
  updatedAt: Schema.NullOr(Revision),
  publication: Schema.NullOr(TemplatePublication),
  skillsError: Schema.NullOr(text(4096)),
});
// Proposed agent-review-v1 projection; released v0.60.0 has no host detail read.
export const TemplateReview = Schema.Struct({
  ...snapshot,
  id: Id,
  creatorName: text(256),
  updatedAt: Revision,
  versionId: Schema.NullOr(Id),
  version: Schema.NullOr(Count),
  pending: Schema.Boolean,
});
export const TemplateInstalled = Schema.Struct({ agentId: Id, name: text(256) });
export const TemplateAdoption = Schema.Struct({
  operationId: Id,
  kind: Schema.Literals(["template", "marketplace"]),
  sourceId: Id,
  state: Schema.Literals(["pending", "complete", "failed", "interrupted"]),
  agentId: Schema.NullOr(Id),
  name: Schema.NullOr(text(256)),
}).check(
  Schema.makeFilter(
    (result) => result.state !== "complete" || (result.agentId !== null && result.name !== null),
  ),
);
export const OpenbotTemplateReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("templates.preview"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("templates.detail"), templateId: Id }),
  Schema.Struct({ operation: Schema.Literal("templates.listing"), listingId: Id }),
  Schema.Struct({ operation: Schema.Literal("templates.publication"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("templates.adoptions") }),
  Schema.Struct({ operation: Schema.Literal("templates.adoptionStatus"), operationId: Id }),
]);
export const OpenbotTemplateAdminRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("templates.adopt"),
    operationId: Id,
    kind: Schema.Literals(["template", "marketplace"]),
    sourceId: Id,
    timezone: text(255),
    expectedRevision: text(128).check(Schema.isMinLength(1)),
    agentId: Schema.optional(Id),
  }).check(
    Schema.makeFilter((request) => request.agentId === undefined || request.kind === "marketplace"),
  ),
  Schema.Struct({
    operation: Schema.Literal("templates.installMarketplace"),
    listingId: Id,
    timezone: text(255),
    receiptId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("templates.install"),
    templateId: Id,
    timezone: text(255),
    expectedUpdatedAt: Revision,
  }),
  Schema.Struct({
    operation: Schema.Literal("templates.updateMarketplace"),
    agentId: Id,
    listingId: Id,
    timezone: text(255),
  }),
  Schema.Struct({ operation: Schema.Literal("templates.publish"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("templates.unpublish"), agentId: Id }),
]);
export type TemplateReview = typeof TemplateReview.Type;
export type TemplatePreview = typeof TemplatePreview.Type;
export type TemplateAdoption = typeof TemplateAdoption.Type;
export type TemplateRequest =
  | typeof OpenbotTemplateReadRequest.Type
  | typeof OpenbotTemplateAdminRequest.Type;
export function templateIsRead(
  request: TemplateRequest,
): request is typeof OpenbotTemplateReadRequest.Type {
  return [
    "templates.preview",
    "templates.detail",
    "templates.listing",
    "templates.publication",
    "templates.adoptions",
    "templates.adoptionStatus",
  ].includes(request.operation);
}
export function templateRequiredScopes(
  operation: unknown,
  kind: "read" | "admin",
): readonly AuthEnvironmentScope[] | null {
  if (operation === "templates.listing" && kind === "read") return [AuthSettingsWriteScope];
  const read = [
    "templates.preview",
    "templates.detail",
    "templates.listing",
    "templates.publication",
    "templates.adoptions",
    "templates.adoptionStatus",
  ];
  const admin = [
    "templates.adopt",
    "templates.installMarketplace",
    "templates.install",
    "templates.updateMarketplace",
    "templates.publish",
    "templates.unpublish",
  ];
  return typeof operation === "string" && (kind === "read" ? read : admin).includes(operation)
    ? kind === "read"
      ? [AuthSettingsWriteScope, AuthProvidersManageScope]
      : [AuthSettingsWriteScope, AuthProvidersManageScope, AuthOrchestrationOperateScope]
    : null;
}
