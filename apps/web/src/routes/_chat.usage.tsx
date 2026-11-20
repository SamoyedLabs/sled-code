import { createFileRoute } from "@tanstack/react-router";

import { UnifiedUsagePage, validateUsageSearch } from "../components/usage/UnifiedUsagePage";

export const Route = createFileRoute("/_chat/usage")({
  validateSearch: validateUsageSearch,
  component: UnifiedUsagePage,
});
