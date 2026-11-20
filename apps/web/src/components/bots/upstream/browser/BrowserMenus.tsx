/* oxlint-disable shadcn/no-unknown-classes -- Source browser menus on Base UI. */
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Ellipsis } from "lucide-react";
import { MenuPopup } from "../OpenbotMenu";
import { menuMotionRef } from "../openbotMenuMotion";
import type { BrowserTab, BrowserViewProps } from "./types";
import { browserTabStoppable } from "./types";
import { t } from "./text";
export function BrowserPageMenu({
  view,
  narrow,
  onNewTab,
}: {
  view: BrowserViewProps;
  narrow: boolean;
  onNewTab: () => void;
}) {
  const tab = view.activeTab;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
        aria-label={t("browser.pageActions")}
      >
        <Ellipsis />
      </Menu.Trigger>
      <MenuPopup align="end">
        {narrow && (
          <>
            <Menu.Item
              className="ui-action-menu-item"
              disabled={!view.canControl || !tab || tab.canGoForward === false}
              onClick={() => tab && view.onNavigate(tab.id, "forward")}
            >
              {t("browser.goForward")}
            </Menu.Item>
            <Menu.Item
              className="ui-action-menu-item"
              disabled={!view.canControl || !tab?.url}
              onClick={() =>
                tab && (browserTabStoppable(tab) ? view.onStop(tab.id) : view.onReload(tab.id))
              }
            >
              {t(browserTabStoppable(tab) ? "browser.stopLoading" : "browser.reload")}
            </Menu.Item>
            <Menu.Separator className="ui-action-menu-separator" />
          </>
        )}
        <Menu.Item className="ui-action-menu-item" disabled={!view.canControl} onClick={onNewTab}>
          {t("browser.newTab")}
        </Menu.Item>
        <Menu.Item
          className="ui-action-menu-item"
          disabled={!view.canControl || !view.canReopen}
          onClick={view.onReopenTab}
        >
          {t("browser.tab.reopenClosed")}
        </Menu.Item>
        {tab && (
          <Menu.Item
            className="ui-action-menu-item"
            disabled={!view.canControl}
            onClick={() =>
              tab.userControl ? view.onReleaseControl?.(tab.id) : view.onTakeControl?.(tab.id)
            }
          >
            {t(tab.userControl ? "prompt.browser.done" : "island.action.takeOver")}
          </Menu.Item>
        )}
        {view.onComputer && (
          <Menu.Item className="ui-action-menu-item" onClick={view.onComputer}>
            {t("remoteDesktop.workspaceLabel")}
          </Menu.Item>
        )}
        <Menu.Separator className="ui-action-menu-separator" />
        <Menu.Item className="ui-action-menu-item" onClick={view.onBack}>
          {t("browser.hide")}
        </Menu.Item>
      </MenuPopup>
    </Menu.Root>
  );
}
export function BrowserTabMenu({
  view,
  tab,
  onNewTab,
}: {
  view: BrowserViewProps;
  tab: BrowserTab;
  onNewTab: (afterId: string) => void;
}) {
  const index = view.tabs.findIndex((t) => t.id === tab.id),
    left = index > 0,
    right = index < view.tabs.length - 1;
  const close = (ids: readonly string[]) => view.onCloseTabs(ids);
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner className="openbot-react openbot-popup-positioner" sideOffset={4}>
        <ContextMenu.Popup className="ui-action-menu" ref={menuMotionRef(undefined)}>
          <ContextMenu.Item
            className="ui-action-menu-item"
            disabled={!view.canControl}
            onClick={() => onNewTab(tab.id)}
          >
            {t("browser.tab.newRight")}
          </ContextMenu.Item>
          <ContextMenu.Separator className="ui-action-menu-separator" />
          <ContextMenu.Item
            className="ui-action-menu-item"
            disabled={!view.canControl || !tab.url}
            onClick={() => view.onReload(tab.id)}
          >
            {t("browser.reload")}
          </ContextMenu.Item>
          <ContextMenu.Item
            className="ui-action-menu-item"
            disabled={!view.canControl || !tab.url}
            onClick={() => view.onDuplicateTab(tab.id)}
          >
            {t("browser.tab.duplicate")}
          </ContextMenu.Item>
          {view.tabs.length > 1 && (
            <>
              <ContextMenu.Separator className="ui-action-menu-separator" />
              {left && (
                <ContextMenu.Item
                  className="ui-action-menu-item"
                  onClick={() => view.onMoveTab(tab.id, index - 1)}
                >
                  {t("browser.tab.moveLeft")}
                </ContextMenu.Item>
              )}
              {right && (
                <ContextMenu.Item
                  className="ui-action-menu-item"
                  onClick={() => view.onMoveTab(tab.id, index + 1)}
                >
                  {t("browser.tab.moveRight")}
                </ContextMenu.Item>
              )}
            </>
          )}
          {view.canCloseTabs && (
            <>
              <ContextMenu.Separator className="ui-action-menu-separator" />
              <ContextMenu.Item className="ui-action-menu-item" onClick={() => close([tab.id])}>
                {t("browser.tab.close")}
              </ContextMenu.Item>
              {left && (
                <ContextMenu.Item
                  className="ui-action-menu-item"
                  onClick={() => close(view.tabs.slice(0, index).map((t) => t.id))}
                >
                  {t("browser.tab.closeLeft")}
                </ContextMenu.Item>
              )}
              {right && (
                <ContextMenu.Item
                  className="ui-action-menu-item"
                  onClick={() => close(view.tabs.slice(index + 1).map((t) => t.id))}
                >
                  {t("browser.tab.closeRight")}
                </ContextMenu.Item>
              )}
              {view.tabs.length > 1 && (
                <ContextMenu.Item
                  className="ui-action-menu-item"
                  onClick={() => close(view.tabs.filter((t) => t.id !== tab.id).map((t) => t.id))}
                >
                  {t("browser.tab.closeOthers")}
                </ContextMenu.Item>
              )}
            </>
          )}
          <ContextMenu.Separator className="ui-action-menu-separator" />
          <ContextMenu.Item
            className="ui-action-menu-item"
            disabled={!view.canControl || !view.canReopen}
            onClick={view.onReopenTab}
          >
            {t("browser.tab.reopenClosed")}
          </ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
