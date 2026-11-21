import { useNavigate, useRouter, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH } from "../../guestPage";
import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname.startsWith("/projects/") ||
    pathname === "/pull-requests" ||
    pathname === "/issues" ||
    pathname === "/bots" ||
    pathname.startsWith("/bots/")
  );
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

const LAST_CODE_PATH = "t3:last-code-path";
function restoredCodePath(): string | null {
  try {
    const path = sessionStorage.getItem(LAST_CODE_PATH);
    return path &&
      path.startsWith("/") &&
      !path.startsWith("//") &&
      !path.includes("?") &&
      !path.includes("#") &&
      !isSidebarUtilityPage(path) &&
      !isAppModalPage(path) &&
      !SHELL_LESS_PATHS.has(path)
      ? path
      : null;
  } catch {
    return null;
  }
}
let mainAppHref: string | null = restoredCodePath();
let appModalReturnHref: string | null = null;
let appModalReturnHistoryIndex: number | null = null;
let appModalReturnThreadTarget: ThreadRouteTarget | null = null;
let initialHistoryIndex = 0;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  initialHistoryIndex = router.state.location.state.__TSR_index;
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    // Only an entry that is exactly the return location can be stepped back to.
    appModalReturnHistoryIndex =
      href === router.state.location.href ? router.state.location.state.__TSR_index : null;
    appModalReturnThreadTarget = resolveThreadRouteTarget(
      router.state.matches.at(-1)?.params ?? {},
    );
    if (!isSidebarUtilityPage(pathname)) {
      mainAppHref = href;
      try {
        // Keep only the route path, never pairing credentials or other query data. Storage is scoped to this browser tab.
        sessionStorage.setItem(LAST_CODE_PATH, pathname);
      } catch {
        // Memory still preserves mode switching when browser storage is unavailable.
      }
    }
  };
  record();
  return router.subscribe("onResolved", record);
}

/** The thread Settings or Usage opened over, for views mounted while the modal is open. */
export function getAppModalReturnThreadTarget() {
  return appModalReturnThreadTarget;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  const router = useRouter();
  return () => {
    const href = appModalReturnHref ?? mainAppHref ?? "/";
    const returnIndex = appModalReturnHistoryIndex ?? 0;
    const steps = router.state.location.state.__TSR_index - returnIndex;
    // Stepping back past this document's first entry reloads the page. Written as a negated
    // comparison so a missing (NaN) history index also falls back to client navigation.
    if (!(returnIndex > initialHistoryIndex && steps > 0)) return navigate({ href, replace: true });
    // Go back to the entry before the return page and push it again: only a push drops the
    // modal's entries from forward history, and reusing the old entry avoids a duplicate stop.
    const unsubscribe = router.history.subscribe(() => {
      unsubscribe();
      void navigate({ href });
    });
    router.history.go(-(steps + 1));
  };
}
