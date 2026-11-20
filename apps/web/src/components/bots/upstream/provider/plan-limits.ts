import type { AccountUsageLimit, AccountUsageWindow } from "./types";
import {
  type AgentProviderId,
  accountUsageCoversModel,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  usageQuotaForModel,
} from "./identity";
export type PlanLimitTone = "neutral" | "warning" | "critical";

/** One limit window that a provider reported, such as its 5-hour or its weekly window. */
export interface PlanLimitWindow {
  durationMins: number | null;
  remainingPercent: number;
  tone: PlanLimitTone;
  /** Unix seconds. */
  resetsAt: number | null;
}

/** The limits of one provider account that reported at least one window. */
export interface PlanLimitRow {
  provider: AgentProviderId;
  /** The account after the first that the reading is for. Null for the provider's own sign-in. */
  accountId: string | null;
  /** The shortest window first, so a weekly limit does not hide the 5-hour one. */
  windows: readonly PlanLimitWindow[];
  /** What is left of the window that stops work first. */
  remainingPercent: number;
  tone: PlanLimitTone;
}

export type PlanLimitWindowKind =
  | { kind: "limit" | "weekly" | "monthly" | "daily" | "fiveHour" }
  | { kind: "hours"; hours: number }
  | { kind: "minutes"; minutes: number };

export function planLimitWindowKind(durationMins: number | null): PlanLimitWindowKind {
  if (durationMins === null) return { kind: "limit" };
  if (nearDuration(durationMins, 10_080)) return { kind: "weekly" };
  if (nearDuration(durationMins, 43_200) || nearDuration(durationMins, 40_320))
    return { kind: "monthly" };
  if (nearDuration(durationMins, 1_440)) return { kind: "daily" };
  if (nearDuration(durationMins, 300)) return { kind: "fiveHour" };
  if (durationMins >= 60 && durationMins % 60 === 0)
    return { kind: "hours", hours: durationMins / 60 };
  return { kind: "minutes", minutes: Math.round(durationMins) };
}

function nearDuration(durationMins: number, targetMins: number): boolean {
  return Math.abs(durationMins - targetMins) <= targetMins * 0.05;
}

/** Remaining quota from a provider-reported used percentage. */
export function usageRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.round(100 - usedPercent));
}

export function usageTone(remainingPercent: number | null): PlanLimitTone {
  if (remainingPercent === null || remainingPercent >= 30) return "neutral";
  return remainingPercent < 10 ? "critical" : "warning";
}

/** The windows of a reading, the shortest first. A window with no duration comes last. */
export function reportedUsageWindows(
  limit: Pick<AccountUsageLimit, "primary" | "secondary" | "tertiary">,
): AccountUsageWindow[] {
  return [limit.primary, limit.secondary, limit.tertiary]
    .filter((window): window is AccountUsageWindow => window != null)
    .sort(
      (left, right) =>
        (left.windowDurationMins ?? Number.POSITIVE_INFINITY) -
        (right.windowDurationMins ?? Number.POSITIVE_INFINITY),
    );
}

/** A plan window that is spent and has not ended yet, as the composer notice and the model picker read it. */
export interface SpentUsageWindow {
  slot: "primary" | "secondary";
  window: AccountUsageWindow;
  /** False for a provider-level reading that does not limit the model (`accountUsageCoversModel`). */
  covers: boolean;
}

/**
 * The plan window of the account that stops the model now and resets last. Only the account's own reading
 * counts: another account of the same provider has its own quota. `usedPercent` is what the provider
 * reports, so it can pass 100 slightly. A window that ended gives the quota back, and its reading
 * stays as it was until something asks the provider again, so the clock is an input.
 */
export function spentUsageWindow(
  limits: readonly AccountUsageLimit[] | undefined,
  provider: AgentProviderId,
  accountId: string,
  model: string | null | undefined,
  nowMs: number,
): SpentUsageWindow | null {
  for (const limit of limits ?? []) {
    if (limit.id !== provider || (limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) !== accountId)
      continue;
    // A provider that names quota groups limits each group apart: only the model's group can stop it,
    // and a model that no group lists has no spent window.
    const quota = usageQuotaForModel(limit, model);
    if (!quota) continue;
    // When two windows are spent, the model can run only after both reset: keep the one that resets
    // last. A window with no reset time never gives the quota back.
    let spent: SpentUsageWindow | null = null;
    for (const slot of ["primary", "secondary"] as const) {
      const window = quota[slot];
      if (!window || window.usedPercent < 100) continue;
      if (window.resetsAt !== null && window.resetsAt * 1_000 <= nowMs) continue;
      if (
        spent &&
        (window.resetsAt ?? Number.POSITIVE_INFINITY) <=
          (spent.window.resetsAt ?? Number.POSITIVE_INFINITY)
      )
        continue;
      // A named group is the model's own quota.
      spent = { slot, window, covers: quota !== limit || accountUsageCoversModel(provider, model) };
    }
    if (spent) return spent;
  }
  return null;
}
