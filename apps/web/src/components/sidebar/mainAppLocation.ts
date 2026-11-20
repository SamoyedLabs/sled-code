import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH } from "../../guestPage";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname.startsWith("/projects/") ||
    pathname === "/pull-requests" ||
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

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, href } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    appModalReturnHref = href;
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

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
