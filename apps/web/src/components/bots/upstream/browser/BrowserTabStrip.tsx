/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Source tab strip geometry, close affordance and profile titles. */
import { useState, type CSSProperties } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Globe2, LoaderCircle, X } from "lucide-react";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { MenuPopup } from "../OpenbotMenu";
import { connectTabStrip, type TabRow } from "./tab-strip-motion";
import { BrowserTabMenu } from "./BrowserMenus";
import { browserDisplayUrl } from "./browser-suggestions";
import type { BrowserTab, BrowserViewProps } from "./types";
import { t } from "./text";
export function tabTitle(tab: BrowserTab) {
  return tab.loading && !tab.title
    ? t("common.loading")
    : tab.title || browserDisplayUrl(tab.url) || t("browser.newTab");
}
export function TabIcon({ view, tab }: { view: BrowserViewProps; tab: BrowserTab }) {
  return tab.loading ? (
    <LoaderCircle className="browser-full-spin" aria-hidden="true" />
  ) : (
    (view.ownerForTab?.(tab) ?? <Globe2 className="browser-full-owner-globe" aria-hidden="true" />)
  );
}
export function BrowserTabStrip({
  view,
  onNewTab,
}: {
  view: BrowserViewProps;
  onNewTab: (afterId?: string) => void;
}) {
  const [row, setRow] = useState<TabRow>({
    hidden: [],
    fadeStart: false,
    fadeEnd: false,
    frozen: 0,
  });
  const latest = useStableCallback(() => view);
  const close = useStableCallback((ids: readonly string[]) => view.onCloseTabs(ids));
  const [controls, setControls] = useState<ReturnType<typeof connectTabStrip> | null>(null);
  const bind = useStableCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const controller = connectTabStrip(
      element,
      latest,
      (change) =>
        setRow((old) => {
          const next = { ...old };
          change(next);
          return next;
        }),
      close,
    );
    setControls(controller);
    const observer = new MutationObserver(() => controller.sync(latest().activeTab?.id));
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-selected"],
    });
    controller.sync(latest().activeTab?.id);
    return () => {
      observer.disconnect();
      controller.dispose();
    };
  });
  return (
    <>
      <Tabs.List
        ref={bind}
        className="side-panel-tabs browser-full-chips no-drag"
        aria-label={t("browser.tabs.label")}
        data-frozen={row.frozen ? "" : undefined}
        data-fade-start={row.fadeStart ? "" : undefined}
        data-fade-end={row.fadeEnd ? "" : undefined}
        style={
          row.frozen
            ? ({ "--browser-full-chip-frozen": `${row.frozen}px` } as CSSProperties)
            : undefined
        }
        onPointerLeave={() => {
          if (row.frozen) setRow((old) => ({ ...old, frozen: 0 }));
        }}
      >
        {view.tabs.map((tab) => (
          <ContextMenu.Root key={tab.id}>
            <ContextMenu.Trigger
              render={<div />}
              role="presentation"
              className="side-panel-tab browser-full-chip"
              data-tab-id={tab.id}
              data-selected={view.activeTab?.id === tab.id ? "true" : undefined}
              onPointerDown={(event) => controls?.onChipPointerDown(event.nativeEvent, tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  controls?.closeWithPointer(tab.id);
                }
              }}
              onDragStart={(event) => event.preventDefault()}
            >
              <button
                className="ui-button ui-button-variant-ghost side-panel-tab-close"
                tabIndex={-1}
                aria-hidden="true"
                disabled={!view.canCloseTabs}
                title={
                  tab.title
                    ? t("browser.tab.closeNamed", { name: tab.title })
                    : t("browser.tab.closeUnnamed")
                }
                onClick={() => controls?.closeWithPointer(tab.id)}
              >
                <span className="side-panel-tab-icon">
                  <TabIcon view={view} tab={tab} />
                </span>
                <X className="side-panel-tab-x" aria-hidden="true" />
              </button>
              <Tabs.Tab
                value={tab.id}
                className="ui-button ui-button-variant-ghost side-panel-tab-select"
                onClick={() => view.onActivateTab(tab.id)}
                aria-label={tabTitle(tab)}
                aria-description={view.canCloseTabs ? t("browser.tab.closeHint") : undefined}
                aria-busy={tab.loading || undefined}
                title={tabTitle(tab)}
                onKeyDown={(event) => {
                  if (event.key === "Delete" && view.canCloseTabs) {
                    event.preventDefault();
                    view.onCloseTabs([tab.id]);
                  }
                }}
              >
                <span className="side-panel-tab-label">{tabTitle(tab)}</span>
              </Tabs.Tab>
            </ContextMenu.Trigger>
            <BrowserTabMenu view={view} tab={tab} onNewTab={onNewTab} />
          </ContextMenu.Root>
        ))}
      </Tabs.List>
      {row.hidden.length > 0 && (
        <Menu.Root>
          <Menu.Trigger
            className="ui-button ui-button-variant-ghost ui-button-size-icon-sm no-drag"
            aria-label={t("browser.tabs.more", { count: row.hidden.length })}
          >
            <ChevronDown />
          </Menu.Trigger>
          <MenuPopup align="end" className="browser-full-hidden-tabs">
            {view.tabs
              .filter((tab) => row.hidden.includes(tab.id))
              .map((tab) => (
                <Menu.Item
                  key={tab.id}
                  className="ui-action-menu-item"
                  aria-current={view.activeTab?.id === tab.id ? "true" : undefined}
                  onClick={() => {
                    view.onActivateTab(tab.id);
                    controls?.reveal(tab.id);
                  }}
                >
                  <TabIcon view={view} tab={tab} />
                  <span>{tabTitle(tab)}</span>
                </Menu.Item>
              ))}
          </MenuPopup>
        </Menu.Root>
      )}
    </>
  );
}
