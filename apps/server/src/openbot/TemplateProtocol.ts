import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  TemplatePreview,
  TemplateReview,
  TemplatePublication,
  TemplateInstalled,
  type TemplateRequest,
} from "@t3tools/contracts/openbot-templates";
const decodeEmpty = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
const paths = {
  "templates.preview": "/v1/admin/agents/template-preview",
  "templates.publish": "/v1/admin/agents/template-publish",
  "templates.unpublish": "/v1/admin/agents/template-unpublish",
  "templates.install": "/v1/admin/agents/install-template",
  "templates.installMarketplace": "/v1/admin/agents/install-marketplace",
  "templates.updateMarketplace": "/v1/admin/agents/update-marketplace",
  "templates.detail": "/v1/admin/agents/template-detail",
  "templates.listing": "/v1/admin/agents/marketplace-detail",
} as const;
export function isRequest(request: { readonly operation: string }): request is TemplateRequest {
  return Object.hasOwn(paths, request.operation);
}
export function route(request: TemplateRequest) {
  const operation = request.operation;
  const body =
    operation === "templates.install"
      ? {
          templateId: request.templateId,
          timezone: request.timezone,
          expectedUpdatedAt: request.expectedUpdatedAt,
        }
      : operation === "templates.installMarketplace"
        ? { listingId: request.listingId, timezone: request.timezone, receiptId: request.receiptId }
        : operation === "templates.updateMarketplace"
          ? { agentId: request.agentId, listingId: request.listingId, timezone: request.timezone }
          : operation === "templates.detail"
            ? { templateId: request.templateId }
            : operation === "templates.listing"
              ? { listingId: request.listingId }
              : operation === "templates.publish"
                ? { agentId: request.agentId, card: null }
                : { agentId: request.agentId };
  return { method: "POST" as const, path: paths[operation], body, templateProjection: operation };
}

export const project = Effect.fn("OpenbotTemplateProtocol.project")((
  operation: TemplateRequest["operation"],
  value: unknown,
) => {
  if (operation === "templates.unpublish") return decodeEmpty(value).pipe(Effect.as({}));
  const schema: Schema.Codec<unknown> =
    operation === "templates.preview"
      ? TemplatePreview
      : operation === "templates.detail" || operation === "templates.listing"
        ? TemplateReview
        : operation === "templates.publish"
          ? TemplatePublication
          : TemplateInstalled;
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
  );
});
