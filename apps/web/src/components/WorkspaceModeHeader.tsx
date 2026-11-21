/* oxlint-disable shadcn/no-unknown-classes -- Shared shell selectors are defined in workspace-mode.css. */
import {
  HouseIcon,
  ListChecksIcon,
  WorkflowIcon,
  WaypointsIcon,
  CalendarClockIcon,
  SettingsIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { isElectron } from "../env";
import { randomUUID } from "../lib/utils";
import { createContext, useState } from "react";
import { useIssuesSupported, usePullRequestsSupported } from "../state/environments";
import { IssueGlyph } from "./issue/issuePresentation";
import { readIssueListPreferences } from "./issue/issueListPreferences";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "./pullRequest/pullRequestListPreferences";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { useSidebarVisibility } from "./ui/sidebar";
import { isAppModalPage, isSidebarUtilityPage } from "./sidebar/mainAppLocation";
import "./workspace-mode.css";
import { SidebarUpdatePill } from "./sidebar/SidebarUpdatePill";
import { WorkspaceRailUsage } from "./bots/WorkspaceRailUsage";

export const WorkspaceSidebarSizeContext = createContext<{
  width: number;
  resize: (width: number) => void;
  reset: () => void;
} | null>(null);

export function useWorkspaceBotsMode() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const current = pathname.startsWith("/bots");
  const [retained, setRetained] = useState(current);
  if (!isAppModalPage(pathname) && current !== retained) setRetained(current);
  return isAppModalPage(pathname) ? retained : current;
}

export function WorkspaceSidebarHeader() {
  const bots = useWorkspaceBotsMode();
  const visible = useSidebarVisibility();
  return (
    <div className="workspace-sidebar-header" hidden={!bots && !visible}>
      <SidebarChromeHeader isElectron={isElectron} />
      <WorkspaceModeTabs />
    </div>
  );
}
import { useNavigateToMainApp } from "./sidebar/mainAppLocation";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { validateBotWorkspaceSearch, type BotWorkspacePage } from "./bots/workspaceNavigation";
import { T, useGT } from "gt-react";

export function WorkspaceViewSwitcher({
  bots,
  onBots,
  onThreads,
}: {
  bots: boolean;
  onBots: () => void;
  onThreads: () => void;
}) {
  const gt = useGT();
  return (
    <nav
      aria-label={gt("Workspace views")}
      className="workspace-view-switcher"
      data-mode={bots ? "bots" : "threads"}
    >
      <span className="workspace-view-indicator" aria-hidden="true" />
      <button type="button" aria-current={!bots ? "page" : undefined} onClick={onThreads}>
        <T>Threads</T>
      </button>
      <button type="button" aria-current={bots ? "page" : undefined} onClick={onBots}>
        <T>Bots</T>
      </button>
    </nav>
  );
}

function WorkspaceModeTabs() {
  const bots = useWorkspaceBotsMode();
  const navigate = useNavigate();
  const openCode = useNavigateToMainApp();
  return (
    <WorkspaceViewSwitcher
      bots={bots}
      onBots={() => {
        if (!bots) void navigate({ to: "/bots" });
      }}
      onThreads={() => {
        if (bots) void openCode();
      }}
    />
  );
}
export function WorkspaceModeRail() {
  const gt = useGT();
  const navigate = useNavigate();
  const openCode = useNavigateToMainApp();
  const location = useLocation();
  const search = validateBotWorkspaceSearch(location.search);
  const bots = useWorkspaceBotsMode();
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const item =
    "workspace-rail-item relative flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:text-foreground";
  const openPage = (page: BotWorkspacePage) =>
    void navigate({
      to: "/bots",
      search: {
        ...(search.machine ? { machine: search.machine } : {}),
        botPage: page,
        botVisit: randomUUID(),
      },
    });
  return (
    <TooltipProvider>
      <nav
        aria-label={gt("Workspace navigation")}
        className="relative z-20 flex shrink-0 flex-col items-center gap-2 pb-3"
        style={{
          width: "var(--workspace-mode-rail-width)",
          paddingTop: "88px",
          background: "linear-gradient(to bottom, transparent 80px, var(--sidebar) 80px)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-px"
          style={{
            background: "linear-gradient(to bottom, transparent 40px, var(--sidebar-border) 80px)",
          }}
        />
        {isElectron && (
          <div
            aria-hidden="true"
            className="drag-region absolute inset-x-0 top-0 h-[var(--workspace-topbar-height)]"
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Home"
                aria-current={
                  !isAppModalPage(location.pathname) &&
                  (bots
                    ? (search.botPage ?? "chats") === "chats"
                    : !isSidebarUtilityPage(location.pathname))
                    ? "page"
                    : undefined
                }
                className={item}
                onClick={() => (bots ? openPage("chats") : void openCode())}
              />
            }
          >
            <HouseIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="right">Home</TooltipPopup>
        </Tooltip>
        {pullRequestsSupported && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Pull requests")}
                  aria-current={location.pathname === "/pull-requests" ? "page" : undefined}
                  className={item}
                  onClick={() =>
                    void navigate({
                      to: "/pull-requests",
                      search: readPullRequestListPreferences(),
                    })
                  }
                />
              }
            >
              <PullRequestGlyph.pullRequest className="size-5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Pull requests</T>
            </TooltipPopup>
          </Tooltip>
        )}
        {issuesSupported && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Issues")}
                  aria-current={location.pathname === "/issues" ? "page" : undefined}
                  className={item}
                  onClick={() =>
                    void navigate({
                      to: "/issues",
                      search: readIssueListPreferences(),
                    })
                  }
                />
              }
            >
              <IssueGlyph.issue className="size-5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Issues</T>
            </TooltipPopup>
          </Tooltip>
        )}
        {(
          [
            ["flows", "Routines", WorkflowIcon],
            ["workflows", "Workflows", WaypointsIcon],
            ["tasks", "Tasks", ListChecksIcon],
            ["schedule", "Schedule", CalendarClockIcon],
          ] as const
        ).map(([page, label, Icon]) => (
          <Tooltip key={page}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  aria-current={bots && (search.botPage ?? "chats") === page ? "page" : undefined}
                  className={item}
                  onClick={() => openPage(page)}
                />
              }
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup side="right">{label}</TooltipPopup>
          </Tooltip>
        ))}
        <div className="mt-auto" />
        <ul className="m-0 flex list-none flex-col items-center p-0" aria-label={gt("Updates")}>
          <SidebarUpdatePill rail />
        </ul>
        <WorkspaceRailUsage />
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/settings/general"
                aria-label={gt("Settings")}
                aria-current={location.pathname.startsWith("/settings") ? "page" : undefined}
                className={item}
              />
            }
          >
            <SettingsIcon className="size-5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="right">
            <T>Settings</T>
          </TooltipPopup>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}
