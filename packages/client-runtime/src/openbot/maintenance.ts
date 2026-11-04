import type { OpenbotMaintenanceProposal } from "@t3tools/contracts";

export function openbotMaintenanceProgress(proposal: OpenbotMaintenanceProposal): string {
  switch (proposal.state) {
    case "proposed":
      return "Ready for source review";
    case "review-queued":
      return "Review launch needs confirmation";
    case "reviewing":
      return "Review in progress";
    case "decision-required":
      return "Your decision is needed";
    case "accepted":
      return "Review accepted";
    case "rejected":
      return "Release rejected";
  }
}
