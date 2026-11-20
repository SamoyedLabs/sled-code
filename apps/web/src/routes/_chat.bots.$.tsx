import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { OpenbotNotificationTarget } from "@t3tools/contracts";
import {
  parseBotNotificationDeepLink,
  botNotificationDeepLink,
} from "@t3tools/shared/agentAwareness";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { BotNotificationDestination } from "../components/bots/BotNotificationDestination";
import { SidebarInset } from "../components/ui/sidebar";
import { workspaceAreaProps } from "../lib/workspaceFocus";
const decodeTarget = Schema.decodeUnknownOption(OpenbotNotificationTarget);
export const Route = createFileRoute("/_chat/bots/$")({ component: NotificationRoute });
function NotificationRoute() {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (pathname === "/bots/ai-elements-preview") return null;
  const decoded = decodeTarget(parseBotNotificationDeepLink(pathname));
  return (
    <SidebarInset
      {...workspaceAreaProps("bots", 1, "Bot notification")}
      className="h-[var(--workspace-shell-height,100dvh)] min-h-0 overflow-auto"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="text-sm font-medium">Bot notification</h1>
        <Link className="ml-auto text-sm" to="/bots">
          All bots
        </Link>
      </header>
      <main className="space-y-4 p-5">
        {Option.isSome(decoded) ? (
          <BotNotificationDestination
            key={botNotificationDeepLink(decoded.value)}
            target={decoded.value}
          />
        ) : (
          <p role="alert">This notification target is invalid.</p>
        )}
      </main>
    </SidebarInset>
  );
}
