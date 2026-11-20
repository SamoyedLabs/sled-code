import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  Activity,
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useRouter, type AnyRouter } from "@tanstack/react-router";

import { moveWorkspaceFocus, workspaceAreaProps } from "../lib/workspaceFocus";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentIdentificationMode } from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import {
  WorkspaceModeRail,
  WorkspaceSidebarHeader,
  WorkspaceSidebarSizeContext,
  useWorkspaceBotsMode,
} from "./WorkspaceModeHeader";
import { BotsWorkspacePane } from "./bots/BotsWorkspacePane";
import { BackgroundThreadAnnouncer } from "./BackgroundThreadAnnouncer";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";
import ThreadSidebar from "./Sidebar";
import { SidebarBrandWidthProbe } from "./sidebar/SidebarChrome";
import { isAppModalPage } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { useSidebarStageBackdropVariant } from "./SidebarStageBackdrop";
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { resolveThreadRouteRef } from "../threadRoutes";

const BotElementsPreview = lazy(() =>
  import("./bots/BotElementsPreview").then((module) => ({ default: module.BotElementsPreview })),
);

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function readUsagePageOpen(router: AnyRouter) {
  return router.state.location.pathname === "/usage";
}

function isKeybindingCaptureTarget(event: KeyboardEvent) {
  return event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]");
}

function readRoutePanelsOpen(router: AnyRouter) {
  const routeThreadRef = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
  if (!routeThreadRef) return { terminalOpen: false, previewOpen: false };
  return {
    terminalOpen: selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      routeThreadRef,
    ).terminalOpen,
    previewOpen:
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
      "preview",
  };
}

export function registerNavigationHistoryCommands(router: AnyRouter): () => void {
  return registerCommands(
    {
      "navigation.back": (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.history.back();
      },
      "navigation.forward": (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.history.forward();
      },
    },
    {
      when: (event) => !isKeybindingCaptureTarget(event),
      context: () => ({
        ...readRoutePanelsOpen(router),
        usagePageOpen: readUsagePageOpen(router),
      }),
    },
  );
}

// Capture phase, so F6 also leaves widgets that swallow keys, such as the terminal.
function registerWorkspaceFocusCommands(router: AnyRouter): () => void {
  const move = (direction: 1 | -1) => (event: KeyboardEvent) => {
    if (event.isComposing) return false;
    // Inside a dialog the move is refused, but the key is still consumed.
    event.preventDefault();
    event.stopPropagation();
    moveWorkspaceFocus(direction);
  };
  const disposers = [
    registerCommands(
      { "workspace.focusNext": move(1), "workspace.focusPrevious": move(-1) },
      {
        capture: true,
        when: (event) => !isKeybindingCaptureTarget(event),
        context: () => readRoutePanelsOpen(router),
      },
    ),
    // A focused desktop browser forwards the keys; its renderer focus is stale.
    registerMenuAction("workspace.focusNext", () => moveWorkspaceFocus(1, "panel")),
    registerMenuAction("workspace.focusPrevious", () => moveWorkspaceFocus(-1, "panel")),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// Escape leaves the pull requests page when no scope (a selection, a dialog,
// a drag) claimed it, so it observes after every other scope.
function registerPullRequestsEscapeCommand(router: AnyRouter): () => void {
  return registerCommands(
    {},
    {
      observe: (event, consumed) => {
        if (consumed || event.repeat || event.isComposing || event.key !== "Escape") return;
        if (router.state.location.pathname !== "/pull-requests") return;
        event.preventDefault();
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
        if (router.state.location.state.__TSR_index !== 0) {
          window.history.back();
          return;
        }
        void router.navigate({ to: "/" });
      },
    },
  );
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// A held key undoes once. Module state: undoing an archive navigates, and the
// hold must survive whatever that re-renders.
let heldUndoKey: string | null = null;

// Undoes the thread actions in the sidebar's notice. Settings and Usage own
// mod+z while open. Captured so mod+z reaches it before the composer's own
// undo handler consumes the key.
function registerThreadUndoCommands(
  router: AnyRouter,
  readSidebarVisible: () => boolean,
): () => void {
  const threadSidebarShown = () => !isAppModalPage(router.state.location.pathname);
  const unregister = registerCommands(
    {},
    {
      capture: true,
      when: threadSidebarShown,
      onKeyDown: (event) => {
        // Cancel a held key's repeats so they cannot fall through to the
        // editor's own undo, even after the last notice is gone.
        if (event.repeat) {
          if (event.code !== heldUndoKey) return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        // A modifier tapped mid-hold leaves the held key repeating.
        if (!MODIFIER_KEYS.has(event.key)) heldUndoKey = null;
        const command = resolveShortcutCommand(
          event,
          appAtomRegistry.get(primaryServerKeybindingsAtom),
          {
            context: {
              terminalFocus: isTerminalFocused(),
              previewFocus: isPreviewFocused(),
              ...readRoutePanelsOpen(router),
              // A collapsed sidebar hides the notice, so text fields keep their own undo.
              editableFocus:
                isEditableFocused(event.target) &&
                !(readSidebarVisible() && threadUndoClaimsShortcut()),
              modelPickerOpen: isModelPickerOpen(),
            },
          },
        );
        if (command !== "thread.undo") {
          if (!MODIFIER_KEYS.has(event.key)) releaseThreadUndoShortcut();
          return false;
        }
        if (isCommandPaletteOpen() || isModelPickerOpen()) return false;
        if (!undoLatestThreadAction()) return false;
        heldUndoKey = event.code;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
  );
  // Pastes from a menu, dictation and drops edit text without a keypress.
  const onInput = () => {
    if (threadSidebarShown()) releaseThreadUndoShortcut();
  };
  window.addEventListener("input", onInput, true);
  return () => {
    unregister();
    window.removeEventListener("input", onInput, true);
  };
}

/** Keyboard and menu commands that live as long as the app shell. */
function registerAppShellCommands(router: AnyRouter, shellElement: Element): () => void {
  // The provider mirrors the visibility it renders onto its wrapper, so the
  // committed state is readable when a key arrives.
  const readSidebarVisible = () =>
    shellElement.closest('[data-slot="sidebar-wrapper"]')?.getAttribute("data-sidebar-state") ===
    "expanded";
  const disposers = [
    registerThreadUndoCommands(router, readSidebarVisible),
    registerNavigationHistoryCommands(router),
    registerWorkspaceFocusCommands(router),
    registerPullRequestsEscapeCommand(router),
    registerMenuAction("open-remote-desktop-settings", () => {
      void router.navigate({ to: "/settings/devices", hash: "remote-desktop" });
    }),
    registerMenuAction("open-settings", () => {
      if (!/^\/settings(\/|$)/.test(router.state.location.pathname))
        void router.navigate({ to: "/settings" });
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

function SidebarControl() {
  const router = useRouter();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const botsMode = useLocation({ select: (location) => location.pathname.startsWith("/bots") });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar, isMobile, mobileSheetMounted } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(environmentIdentificationMode);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that toggles the sidebar on its shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event, window.getSelection()) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B only to bold selected text;
        // the toggle stays available everywhere else.
        return;
      }
      if (
        resolveShortcutCommand(event, keybindings, { context: { usagePageOpen } }) !==
        "sidebar.toggle"
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "sidebar.toggle") toggleSidebar();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings, toggleSidebar, usagePageOpen]);

  // The control lives as long as the shell, so it carries the shell's commands. Created
  // once so re-renders never re-register them.
  const [appShellCommandsRef] = useState(
    () => (node: HTMLDivElement | null) =>
      node === null ? undefined : registerAppShellCommands(router, node),
  );

  return (
    <div
      ref={appShellCommandsRef}
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        (botsMode || (isMobile && mobileSheetMounted)) && "hidden",
      )}
      style={{
        top: "calc(var(--workspace-controls-top) + var(--workspace-shell-top, 48px))",
        left: "calc(var(--workspace-controls-left) + var(--workspace-mode-rail-width, 0px))",
      }}
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const sidebarArea = workspaceAreaProps("sidebar", 0, "Threads");
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const pathname = useLocation({ select: (location) => location.pathname });
  const botsMode = useWorkspaceBotsMode();
  const previewActive = pathname === "/bots/ai-elements-preview";
  const [previewVisited, setPreviewVisited] = useState(previewActive);
  if (previewActive && !previewVisited) setPreviewVisited(true);
  const [botsVisited, setBotsVisited] = useState(botsMode);
  if (botsMode && !botsVisited) setBotsVisited(true);
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;

  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // A clamped drag may not change width, so viewport changes need a separate subscription.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth, sidebarMinimumWidth);
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const windowControlsInsetStyle = {} as CSSProperties;
  const shellTop = 0;
  const sidebarProviderStyle = {
    "--workspace-sidebar-header-height": "calc(var(--workspace-topbar-height) + 44px)",
    "--workspace-shell-height": `calc(100dvh - ${shellTop}px)`,
    "--workspace-shell-top": `${shellTop}px`,
    ...(isElectron && isMacPlatform(navigator.platform)
      ? {
          "--workspace-controls-left":
            "max(12px, calc(var(--desktop-window-controls-inset, 90px) - 52px))",
        }
      : {}),
    "--sidebar-width": `${clampThreadSidebarWidth(sidebarWidth, sidebarMinimumWidth, sidebarMaximumWidth)}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...windowControlsInsetStyle,
  } as CSSProperties;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden dark:bg-black dark:[--sidebar:#000] dark:[--sidebar-row-selected:#0d0d0d] dark:[--sidebar-stage-fade:#000] dark:[--surface-grain:none]"
      style={
        {
          "--workspace-mode-rail-width": "52px",
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1">
        <WorkspaceModeRail />
        <div className="flex min-w-0 flex-1">
          <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
            <SidebarProvider
              className="relative h-full! min-h-0! flex-1"
              data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
              defaultOpen
              style={sidebarProviderStyle}
            >
              <WorkspaceSidebarSizeContext
                value={{
                  width: clampThreadSidebarWidth(
                    sidebarWidth,
                    sidebarMinimumWidth,
                    sidebarMaximumWidth,
                  ),
                  resize: (width) => {
                    const next = clampThreadSidebarWidth(
                      width,
                      sidebarMinimumWidth,
                      sidebarMaximumWidth,
                    );
                    setSidebarWidth(next);
                    setLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, next, Schema.Finite);
                  },
                  reset: resetSidebarWidth,
                }}
              >
                <WorkspaceSidebarHeader />
                <SidebarBrandWidthProbe isElectron={isElectron} onWidthChange={setBrandWidth} />
                <Activity mode={botsMode || previewActive ? "hidden" : "visible"}>
                  <Sidebar
                    side="left"
                    collapsible="offcanvas"
                    data-app-sidebar=""
                    {...sidebarArea}
                    role="navigation"
                    aria-label="Threads"
                    className="left-[var(--workspace-mode-rail-width)] group-data-[collapsible=offcanvas]:left-[calc(var(--workspace-mode-rail-width)-var(--sidebar-width))] group-data-[collapsible=offcanvas]:invisible"
                    resizable={{
                      maxWidth: sidebarMaximumWidth,
                      minWidth: sidebarMinimumWidth,
                      shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
                        nextWidth <= currentWidth ||
                        wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
                      storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
                      onResize: setSidebarWidth,
                    }}
                    style={windowControlsInsetStyle}
                  >
                    <ThreadSidebar routeReveal={sidebarRouteReveal} />
                    <SidebarRail onDoubleClick={resetSidebarWidth} />
                  </Sidebar>
                </Activity>
                {children}
                {previewVisited && (
                  <section
                    className="absolute inset-0 flex min-h-0 flex-col bg-background"
                    aria-label="Retained Bots preview"
                    style={{ display: previewActive ? undefined : "none" }}
                    inert={!previewActive}
                  >
                    <Activity mode={previewActive ? "visible" : "hidden"}>
                      <Suspense
                        fallback={
                          <p className="p-6 text-sm text-muted-foreground">Opening preview…</p>
                        }
                      >
                        <BotElementsPreview />
                      </Suspense>
                    </Activity>
                  </section>
                )}
                {botsVisited && <BotsWorkspacePane active={botsMode} />}
              </WorkspaceSidebarSizeContext>
              <BackgroundThreadAnnouncer />
              <SidebarControl />
              {isElectron ? <HistorySwipeNavigation /> : null}
            </SidebarProvider>
          </PanelAnimationSuppressionProvider>
        </div>
      </div>
    </div>
  );
}
