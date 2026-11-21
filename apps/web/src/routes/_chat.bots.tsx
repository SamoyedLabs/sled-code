import { createFileRoute, Outlet } from "@tanstack/react-router";
import { validateBotWorkspaceSearch } from "../components/bots/workspaceNavigation";

export const Route = createFileRoute("/_chat/bots")({
  validateSearch: validateBotWorkspaceSearch,
  component: Outlet,
});
