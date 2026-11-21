import type { OpenbotMaintenanceProposal } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";

export function openbotMaintenanceProgress(proposal: OpenbotMaintenanceProposal): string {
  switch (proposal.state) {
    case "proposed":
      return mFallback(msg("Ready for source review"));
    case "review-queued":
      return mFallback(msg("Review launch needs confirmation"));
    case "reviewing":
      return mFallback(msg("Review in progress"));
    case "decision-required":
      return mFallback(msg("Your decision is needed"));
    case "accepted":
      return mFallback(msg("Review accepted"));
    case "rejected":
      return mFallback(msg("Release rejected"));
  }
}
