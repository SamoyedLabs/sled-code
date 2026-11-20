/* oxlint-disable shadcn/no-unknown-classes -- Source BrowserFullView, tab switcher and address structure. */
import { useEffect, useRef, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Popover } from "@base-ui/react/popover";
import { Globe2, Minimize2, Plus, X } from "lucide-react";
import { BrowserAddressRow } from "./BrowserAddressRow";
import { BrowserTabStrip, TabIcon, tabTitle } from "./BrowserTabStrip";
import { browserDisplayUrl } from "./browser-suggestions";
import type { BrowserViewProps } from "./types";
import { t } from "./text";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { browserViewCommand, type BrowserViewCommand } from "./browser-view-shortcuts";
import "../openbot-side-thread-tabs.css";
import "./Browser.css";
export function BrowserFullView(view: BrowserViewProps) {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const address = useRef<HTMLInputElement>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const keepFocus = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source narrow browser tabs follow the window media query.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const changed = () => setNarrow(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  const newTab = (afterId?: string) => {
    void view.onNewTab(afterId).then(
      () => {
        requestAnimationFrame(() => {
          address.current?.focus();
          address.current?.select();
        });
      },
      () => {},
    );
  };
  const runShortcut = useStableCallback((command: BrowserViewCommand) => {
    const active = view.activeTab;
    const index = view.tabs.findIndex((tab) => tab.id === active?.id);
    if (command.kind === "focusAddress") {
      address.current?.focus();
      address.current?.select();
      return;
    }
    if (!view.canControl) return;
    switch (command.kind) {
      case "select": {
        const tab = view.tabs[(index + command.offset + view.tabs.length) % view.tabs.length];
        if (tab) view.onActivateTab(tab.id);
        break;
      }
      case "selectIndex": {
        const tab = command.index === "last" ? view.tabs.at(-1) : view.tabs[command.index];
        if (tab) view.onActivateTab(tab.id);
        break;
      }
      case "move": {
        const to = Math.max(0, Math.min(view.tabs.length - 1, index + command.offset));
        if (active && index >= 0 && to !== index) view.onMoveTab(active.id, to);
        break;
      }
      case "newTab":
        newTab();
        break;
      case "reopen":
        if (view.canReopen) view.onReopenTab();
        break;
      case "close":
        if (active && view.canCloseTabs) view.onCloseTabs([active.id]);
        break;
      case "reload":
        if (active?.url) view.onReload(active.id);
        break;
      case "back":
        if (active && active.canGoBack !== false) view.onNavigate(active.id, "back");
        break;
      case "forward":
        if (active && active.canGoForward !== false) view.onNavigate(active.id, "forward");
        break;
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The visible desktop browser owns its source keyboard commands; dialogs and the web client's browser keep their own keys.
  useEffect(() => {
    const platform = view.shortcuts;
    if (!platform) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[role=dialog], [role=alertdialog], [role=menu]")
      )
        return;
      const command = browserViewCommand(event, platform);
      if (!command) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runShortcut(command);
    };
    window.addEventListener("keydown", keyDown, true);
    return () => window.removeEventListener("keydown", keyDown, true);
  }, [view.shortcuts, runShortcut]);
  const failure = view.activeTab?.popupFailure;
  return (
    <Tabs.Root
      render={<section />}
      className="browser-full-view"
      aria-label={t("browser.panel.label")}
      value={view.activeTab?.id ?? "__empty"}
      onValueChange={(value) => {
        if (typeof value === "string" && value !== "__empty") view.onActivateTab(value);
      }}
    >
      <div className="browser-full-top window-drag">
        {narrow ? (
          <Popover.Root modal open={switchOpen} onOpenChange={setSwitchOpen}>
            <Popover.Trigger
              className="ui-button ui-button-variant-ghost ui-button-size-sm browser-full-switch no-drag"
              aria-label={t("browser.tabs.switcher", {
                title: view.activeTab ? tabTitle(view.activeTab) : t("browser.panel.label"),
                count: view.tabs.length,
              })}
            >
              {view.activeTab ? <TabIcon view={view} tab={view.activeTab} /> : <Globe2 />}
              <span className="browser-full-switch-title">
                {view.activeTab ? tabTitle(view.activeTab) : t("browser.panel.label")}
              </span>
              <span className="browser-full-switch-count" aria-hidden="true">
                {view.tabs.length}
              </span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                sideOffset={4}
                align="start"
                className="openbot-react openbot-popup-positioner"
              >
                <Popover.Popup
                  className="ui-popover-menu-surface browser-full-switch-menu"
                  finalFocus={() => {
                    if (keepFocus.current) {
                      keepFocus.current = false;
                      return false;
                    }
                    return true;
                  }}
                >
                  <Popover.Title className="sr-only">{t("browser.tabs.label")}</Popover.Title>
                  <ul className="browser-full-switch-list">
                    {view.tabs.map((tab) => (
                      <li key={tab.id} className="browser-full-switch-row">
                        <button
                          className="ui-button ui-button-variant-ghost browser-full-switch-select"
                          aria-current={view.activeTab?.id === tab.id ? "true" : undefined}
                          onClick={() => {
                            setSwitchOpen(false);
                            view.onActivateTab(tab.id);
                          }}
                        >
                          <span className="browser-full-suggest-icon">
                            <TabIcon view={view} tab={tab} />
                          </span>
                          <span className="browser-full-switch-text">
                            <span className="browser-full-suggest-title">{tabTitle(tab)}</span>
                            {tab.url && (
                              <span className="browser-full-suggest-detail">
                                {browserDisplayUrl(tab.url)}
                              </span>
                            )}
                          </span>
                        </button>
                        {view.canCloseTabs && (
                          <button
                            className="ui-button ui-button-variant-ghost ui-button-size-icon-sm browser-full-switch-close"
                            aria-label={t("browser.tab.closeNamed", { name: tabTitle(tab) })}
                            onClick={() => view.onCloseTabs([tab.id])}
                          >
                            <X />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="browser-full-switch-actions">
                    <button
                      className="ui-button ui-button-variant-ghost ui-button-size-sm"
                      disabled={!view.canControl}
                      onClick={() => {
                        keepFocus.current = true;
                        setSwitchOpen(false);
                        newTab();
                      }}
                    >
                      <Plus />
                      {t("browser.newTab")}
                    </button>
                    <button
                      className="ui-button ui-button-variant-ghost ui-button-size-sm"
                      disabled={!view.canControl || !view.canReopen}
                      onClick={() => {
                        setSwitchOpen(false);
                        view.onReopenTab();
                      }}
                    >
                      {t("browser.tab.reopenClosed")}
                    </button>
                  </div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <>
            <BrowserTabStrip view={view} onNewTab={newTab} />
            <button
              className="ui-button ui-button-variant-ghost ui-button-size-icon-sm no-drag"
              aria-label={t("browser.newTab")}
              disabled={!view.canControl}
              onClick={() => newTab()}
            >
              <Plus />
            </button>
          </>
        )}
        <div className="browser-full-top-spacer" />
        <button
          className="ui-button ui-button-variant-ghost ui-button-size-icon-sm no-drag browser-hide"
          aria-label={t("browser.hide")}
          onClick={view.onBack}
        >
          <Minimize2 />
        </button>
      </div>
      <div className="browser-full-card">
        <Tabs.Panel
          keepMounted
          value={view.activeTab?.id ?? "__empty"}
          aria-label={t("browser.panel.label")}
          className="browser-full-browser"
        >
          <BrowserAddressRow
            view={view}
            narrow={narrow}
            onNewTab={() => newTab()}
            addressRef={address}
          />
          {failure && !dismissed.has(failure.id) && (
            <div role="alert" className="browser-full-alert">
              <strong>{t("browser.popupBlocked.title")}</strong>
              <span>{failure.message}</span>
              <button
                className="ui-button ui-button-variant-ghost ui-button-size-icon-xs"
                aria-label={t("browser.popupBlocked.dismiss")}
                onClick={() => setDismissed((old) => new Set([...old, failure.id]))}
              >
                <X />
              </button>
            </div>
          )}
          {view.error && (
            <div role="alert" className="browser-full-alert">
              {view.error}
            </div>
          )}
          <div className="browser-surface browser-full-surface" data-live="">
            {view.activeTab ? (
              view.page
            ) : (
              <div className="browser-empty-state">
                <strong>{t("browser.empty.title")}</strong>
                <span>{t("browser.empty.description")}</span>
              </div>
            )}
          </div>
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  );
}
