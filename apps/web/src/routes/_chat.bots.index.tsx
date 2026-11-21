import { createFileRoute } from "@tanstack/react-router";

// The parent owns the workspace root. An explicit index keeps the notification splat from matching /bots.
export const Route = createFileRoute("/_chat/bots/")({ component: () => null });
