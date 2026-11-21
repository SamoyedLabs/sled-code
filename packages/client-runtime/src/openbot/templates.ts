import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotTemplateAdminRequest,
  TemplatePreview,
  TemplateReview,
  TemplatePublication,
  TemplateInstalled,
  TemplateAdoption,
  templateIsRead,
  type TemplateRequest,
} from "@t3tools/contracts/openbot-templates";
import { mFallback, msg } from "gt-i18n";
const decodeAdmin = Schema.decodeUnknownResult(OpenbotTemplateAdminRequest);
const decodeReview = Schema.decodeUnknownResult(TemplateReview);
const decodePreview = Schema.decodeUnknownResult(TemplatePreview);
const decodeInstalled = Schema.decodeUnknownResult(TemplateInstalled);
const decodePublication = Schema.decodeUnknownResult(
  Schema.Struct({ publication: Schema.NullOr(TemplatePublication) }),
);
const decodeAdoption = Schema.decodeUnknownResult(TemplateAdoption);
const decodeAdoptions = Schema.decodeUnknownResult(
  Schema.Array(TemplateAdoption).check(Schema.isMaxLength(100)),
);
const decodeCapabilities = Schema.decodeUnknownResult(
  Schema.Struct({ capabilities: Schema.Array(Schema.String).check(Schema.isMaxLength(512)) }),
);
export type TemplateActions = {
  readonly can: (request: TemplateRequest) => boolean;
  readonly execute: (request: TemplateRequest) => Promise<unknown>;
};
export type TemplateState = {
  readonly adoptions: readonly TemplateAdoption[];
  readonly acknowledged: readonly string[];
  readonly publication: {
    readonly agentId: string;
    readonly value: typeof TemplatePublication.Type | null;
  } | null;
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
  adoptions: [],
  acknowledged: [],
  publication: null,
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
  durable = false,
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
  const request = durable
    ? (review.kind === "marketplace" && !review.detail.versionId) ||
      (target && target.listingId !== review.detail.id)
      ? null
      : {
          operation: "templates.adopt",
          operationId: receiptId,
          kind: review.kind,
          sourceId: review.detail.id,
          timezone,
          expectedRevision:
            review.kind === "template" ? review.detail.updatedAt : review.detail.versionId,
          ...(target ? { agentId: target.agentId } : {}),
        }
    : review.kind === "template"
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
  if (request.operation === "templates.publication") {
    const result = decodePublication(value);
    return Result.isFailure(result)
      ? null
      : {
          ...state,
          publication: { agentId: request.agentId, value: result.success.publication },
          notice: result.success.publication
            ? mFallback(msg("Published. This status was checked with the host account."))
            : mFallback(msg("Not published. This status was checked with the host account.")),
        };
  }
  if (request.operation === "templates.adoptions") {
    const result = decodeAdoptions(value);
    if (Result.isFailure(result)) return null;
    const pending = state.pending;
    const matching =
      pending?.operation === "templates.adopt"
        ? result.success.find((item) => item.operationId === pending.operationId)
        : undefined;
    if (matching && pending?.operation === "templates.adopt" && !matchesAdoption(pending, matching))
      return null;
    const updated = { ...state, adoptions: result.success };
    return matching ? adoptionResult(updated, matching) : adoptionRecovery(updated);
  }
  if (request.operation === "templates.adopt" || request.operation === "templates.adoptionStatus") {
    if (request.operation === "templates.adoptionStatus" && value === null)
      return {
        ...state,
        notice: mFallback(
          msg(
            "Operation not found on this host for the connected member. The unknown result remains unresolved.",
          ),
        ),
      };
    const result = decodeAdoption(value);
    if (Result.isFailure(result) || result.success.operationId !== request.operationId) return null;
    if (request.operation === "templates.adopt" && !matchesAdoption(request, result.success))
      return null;
    if (
      state.pending?.operation === "templates.adopt" &&
      state.pending.operationId === request.operationId &&
      !matchesAdoption(state.pending, result.success)
    )
      return null;
    return adoptionResult(state, result.success);
  }
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
        ? mFallback(msg("Host reports this publication. A preview does not publish."))
        : mFallback(
            msg(
              "Publication status unavailable or not published. Signed-out or offline hosts also return no publication. A preview does not publish.",
            ),
          ),
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
        ? mFallback(msg("Host confirmed unpublish. Refresh the preview before further changes."))
        : request.operation === "templates.publish"
          ? mFallback(
              msg("Host confirmed publication. Refresh the preview to read the publication link."),
            )
          : mFallback(
              msg(
                "Host confirmed the agent change. Refresh the destination agent list. Coding and approval settings remain host-owned.",
              ),
            ),
  };
}
function matchesAdoption(
  request: Extract<TemplateRequest, { operation: "templates.adopt" }>,
  result: TemplateAdoption,
) {
  return (
    result.kind === request.kind &&
    result.sourceId === request.sourceId &&
    (request.agentId === undefined || result.agentId === request.agentId)
  );
}
function adoptionNeedsInspection(result: TemplateAdoption) {
  return (
    result.state === "pending" ||
    ((result.state === "failed" || result.state === "interrupted") && result.agentId !== null)
  );
}
function adoptionRecovery(state: TemplateState): TemplateState {
  const unknown = state.pending !== null;
  return {
    ...state,
    uncertain:
      unknown ||
      state.adoptions.some(
        (item) => adoptionNeedsInspection(item) && !state.acknowledged.includes(item.operationId),
      ),
  };
}
export function templateAcknowledge(state: TemplateState, operationId: string): TemplateState {
  const result = state.adoptions.find((item) => item.operationId === operationId);
  if (!result || result.state === "pending" || result.state === "complete" || !result.agentId)
    return state;
  return adoptionRecovery({
    ...state,
    acknowledged: [...new Set([...state.acknowledged, operationId])],
    pending:
      state.pending?.operation === "templates.adopt" && state.pending.operationId === operationId
        ? null
        : state.pending,
    review: null,
    notice: mFallback(
      msg(
        "The retained agent stays on the host. Review a source again before starting a new request.",
      ),
    ),
  });
}
export function templateHistoryRequest(state: TemplateState): TemplateRequest {
  return state.pending?.operation === "templates.adopt"
    ? { operation: "templates.adoptionStatus", operationId: state.pending.operationId }
    : { operation: "templates.adoptions" };
}
function adoptionResult(state: TemplateState, result: TemplateAdoption): TemplateState {
  const complete = result.state === "complete";
  const settled =
    complete ||
    ((result.state === "failed" || result.state === "interrupted") && result.agentId === null);
  const ownsPending =
    state.pending?.operation === "templates.adopt" &&
    state.pending.operationId === result.operationId;
  return adoptionRecovery({
    ...state,
    adoptions: [
      result,
      ...state.adoptions.filter((item) => item.operationId !== result.operationId),
    ],
    pending: settled && ownsPending ? null : state.pending,
    review: settled && ownsPending ? null : state.review,
    notice: complete
      ? mFallback(
          msg("Saved {value}. The host saved its identity and outcome.", {
            value: result.name ?? "agent",
          }),
        )
      : result.state === "interrupted"
        ? mFallback(
            msg("Installation was interrupted. {value} This request will not run again.", {
              value: result.agentId
                ? `The host retained ${result.name ?? result.agentId} and its work. Inspect this agent before deciding how to continue.`
                : "The host created no agent.",
            }),
          )
        : result.state === "failed"
          ? result.agentId
            ? mFallback(
                msg(
                  "The change did not finish. The host retained its agent; inspect it before starting another request.",
                ),
              )
            : mFallback(
                msg(
                  "The change did not finish and no agent remains. Check the host and source, then review again to start a new request.",
                ),
              )
          : mFallback(
              msg(
                "The change is still running. Refresh installation history to check its outcome.",
              ),
            ),
  });
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
          request.operation === "templates.adopt"
            ? mFallback(
                msg(
                  "Connection interrupted. Refresh installation history to recover the original host outcome. Starting the same request again will not create another agent.",
                ),
              )
            : mFallback(
                msg(
                  "Host outcome unknown. Check the destination host before another change. A publication preview alone cannot establish an unpublished state while offline.",
                ),
              ),
      };
}
const AgentSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    marketplaceSource: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          agentId: Schema.optional(Schema.String),
          listingId: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
);

const decodeAgents = Schema.decodeUnknownResult(AgentSchema);
export function templateFeatures(value: unknown) {
  const result = decodeCapabilities(value);
  const capabilities = Result.isSuccess(result) ? result.success.capabilities : [];
  return {
    reviewAvailable: capabilities.includes("agent-review-v1"),
    adoptionAvailable: capabilities.includes("agent-adoption-v1"),
  };
}
export function decodeTemplateAgents(value: unknown) {
  const decoded = decodeAgents(value);
  if (Result.isFailure(decoded)) return [];
  return decoded.success.map(({ id, name, marketplaceSource }) => {
    // Team protocol calls the catalog listing ID agentId inside marketplaceSource.
    const listingId = marketplaceSource?.agentId ?? marketplaceSource?.listingId;
    return { id, name, ...(listingId ? { listingId } : {}) };
  });
}
export function templateSchedule(schedule: TemplateReview["routines"][number]["schedule"]): string {
  switch (schedule.kind) {
    case "hourly":
      return mFallback(msg("Every hour at minute {minute}", { minute: schedule.minute }));
    case "daily":
      return mFallback(msg("Daily at {time}", { time: schedule.time }));
    case "weekdays":
      return mFallback(msg("Weekdays at {time}", { time: schedule.time }));
    case "weekly":
      return mFallback(
        msg("Weekly on day {weekday} (Sunday = 0) at {time}", {
          weekday: schedule.weekday,
          time: schedule.time,
        }),
      );
    case "monthly":
      return mFallback(
        msg("Monthly on day {day} at {time}", { day: schedule.day, time: schedule.time }),
      );
    case "interval":
      return mFallback(
        msg("Every {amount} {unit}, anchored {anchorAt}", {
          amount: schedule.amount,
          unit: schedule.unit,
          anchorAt: schedule.anchorAt,
        }),
      );
    case "custom":
      return mFallback(msg("Cron: {expression}", { expression: schedule.expression }));
    case "advanced":
      return mFallback(
        msg("Months {value}; {value2}; {value3}", {
          value: schedule.months.join(", "),
          value2:
            schedule.days.kind === "every-day"
              ? "every day"
              : `${schedule.days.kind}: ${schedule.days.days.join(", ")}`,
          value3:
            schedule.time.kind === "at-time"
              ? schedule.time.time
              : `every ${schedule.time.amount} ${schedule.time.unit}`,
        }),
      );
  }
}
