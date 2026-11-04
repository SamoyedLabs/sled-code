import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotTemplateAdminRequest,
  TemplatePreview,
  TemplateReview,
  TemplatePublication,
  TemplateInstalled,
  templateIsRead,
  type TemplateRequest,
} from "@t3tools/contracts/openbot-templates";
const decodeAdmin = Schema.decodeUnknownResult(OpenbotTemplateAdminRequest);
const decodeReview = Schema.decodeUnknownResult(TemplateReview);
const decodePreview = Schema.decodeUnknownResult(TemplatePreview);
const decodeInstalled = Schema.decodeUnknownResult(TemplateInstalled);
export type TemplateActions = {
  readonly can: (request: TemplateRequest) => boolean;
  readonly execute: (request: TemplateRequest) => Promise<unknown>;
};
export type TemplateState = {
  readonly review: {
    readonly kind: "template" | "marketplace";
    readonly detail: TemplateReview;
  } | null;
  readonly preview: TemplatePreview | null;
  readonly pending: TemplateRequest | null;
  readonly notice: string | null;
  readonly uncertain: boolean;
};
export const EMPTY_TEMPLATES: TemplateState = {
  review: null,
  preview: null,
  pending: null,
  notice: null,
  uncertain: false,
};
export function templateInstall(
  state: TemplateState,
  timezone: string,
  receiptId: string,
  target?: { readonly agentId: string; readonly listingId: string },
) {
  const review = state.review;
  if (
    (target && review?.kind !== "marketplace") ||
    !review ||
    state.uncertain ||
    !validTimezone(timezone) ||
    review.detail.pending
  )
    return null;
  const request =
    review.kind === "template"
      ? {
          operation: "templates.install",
          templateId: review.detail.id,
          timezone,
          expectedUpdatedAt: review.detail.updatedAt,
        }
      : target
        ? target.listingId === review.detail.id
          ? {
              operation: "templates.updateMarketplace",
              agentId: target.agentId,
              listingId: target.listingId,
              timezone,
            }
          : null
        : {
            operation: "templates.installMarketplace",
            listingId: review.detail.id,
            timezone,
            receiptId,
          };
  const decoded = decodeAdmin(request);
  return Result.isSuccess(decoded) ? decoded.success : null;
}
function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return value.length > 0 && value.length <= 255;
  } catch {
    return false;
  }
}
export function templateResult(
  state: TemplateState,
  request: TemplateRequest,
  value: unknown,
): TemplateState | null {
  if (request.operation === "templates.detail" || request.operation === "templates.listing") {
    const decoded = decodeReview(value);
    const id = request.operation === "templates.detail" ? request.templateId : request.listingId;
    if (Result.isFailure(decoded) || decoded.success.id !== id) return null;
    return {
      ...state,
      review: {
        kind: request.operation === "templates.detail" ? "template" : "marketplace",
        detail: decoded.success,
      },
    };
  }
  if (request.operation === "templates.preview") {
    const decoded = decodePreview(value);
    if (Result.isFailure(decoded) || decoded.success.agentId !== request.agentId) return null;
    return {
      ...state,
      preview: decoded.success,
      notice: decoded.success.publication
        ? "Host reports this publication. A preview does not publish."
        : "Publication status unavailable or not published. Signed-out or offline hosts also return no publication. A preview does not publish.",
    };
  }
  if (request.operation === "templates.updateMarketplace") {
    const installed = decodeInstalled(value);
    if (Result.isFailure(installed) || installed.success.agentId !== request.agentId) return null;
  }
  const schema: Schema.Codec<unknown> =
    request.operation === "templates.publish"
      ? TemplatePublication
      : request.operation === "templates.unpublish"
        ? Schema.Struct({})
        : TemplateInstalled;
  const decoded = Schema.decodeUnknownResult(schema)(value);
  if (Result.isFailure(decoded)) return null;
  return {
    ...state,
    preview: null,
    review: null,
    pending: null,
    uncertain: false,
    notice:
      request.operation === "templates.unpublish"
        ? "Host confirmed unpublish. Refresh the preview before further changes."
        : request.operation === "templates.publish"
          ? "Host confirmed publication. Refresh the preview to read the publication link."
          : "Host confirmed the agent change. Refresh the destination agent list. Coding and approval settings remain host-owned.",
  };
}
export function templateStarted(state: TemplateState, request: TemplateRequest): TemplateState {
  return templateIsRead(request)
    ? state
    : { ...state, pending: request, uncertain: true, notice: null };
}
export function templateFailed(state: TemplateState, request: TemplateRequest): TemplateState {
  return templateIsRead(request)
    ? state
    : {
        ...state,
        pending: request,
        uncertain: true,
        preview: null,
        notice:
          "Host outcome unknown. Do not retry creation: marketplace receipt IDs only deduplicate install counts. Reconcile with the destination agent list or host owner. Publication previews cannot establish an unpublished state while offline.",
      };
}
const AgentSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    marketplaceSource: Schema.optional(Schema.NullOr(Schema.Struct({ listingId: Schema.String }))),
  }),
);

const decodeAgents = Schema.decodeUnknownResult(AgentSchema);
export function decodeTemplateAgents(value: unknown) {
  const decoded = decodeAgents(value);
  return Result.isSuccess(decoded)
    ? decoded.success.map((agent) => ({
        id: agent.id,
        name: agent.name,
        ...(agent.marketplaceSource ? { listingId: agent.marketplaceSource.listingId } : {}),
      }))
    : [];
}
export function templateSchedule(schedule: TemplateReview["routines"][number]["schedule"]): string {
  switch (schedule.kind) {
    case "hourly":
      return `Every hour at minute ${schedule.minute}`;
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekdays":
      return `Weekdays at ${schedule.time}`;
    case "weekly":
      return `Weekly on day ${schedule.weekday} (Sunday = 0) at ${schedule.time}`;
    case "monthly":
      return `Monthly on day ${schedule.day} at ${schedule.time}`;
    case "interval":
      return `Every ${schedule.amount} ${schedule.unit}, anchored ${schedule.anchorAt}`;
    case "custom":
      return `Cron: ${schedule.expression}`;
    case "advanced":
      return `Months ${schedule.months.join(", ")}; ${schedule.days.kind === "every-day" ? "every day" : `${schedule.days.kind}: ${schedule.days.days.join(", ")}`}; ${schedule.time.kind === "at-time" ? schedule.time.time : `every ${schedule.time.amount} ${schedule.time.unit}`}`;
  }
}
