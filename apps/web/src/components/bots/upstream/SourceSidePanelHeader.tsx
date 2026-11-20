/* oxlint-disable shadcn/no-unknown-classes -- SidePanelHeader uses the pinned source selectors. */
import {
  Folder,
  Monitor,
  Settings,
  X,
  Plus,
  Maximize2,
  Minimize2,
  PanelRight,
  Brain,
  Repeat,
  Database,
  Shield,
} from "lucide-react";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { MenuPopup } from "./OpenbotMenu";
import { OpenbotSideThreadTabs, type OpenbotSideThreadTabsProps } from "./OpenbotSideThreadTabs";
import type { BotWorkspaceView } from "../BotWorkspaceChrome";
export type SourcePane = Exclude<BotWorkspaceView, "Chat" | "Tasks">;
const panes: readonly SourcePane[] = [
  "Files",
  "Browser",
  "Computer",
  "Memory",
  "Routines",
  "Data",
  "Vault",
  "Settings",
];
const icons = {
  Browser: Monitor,
  Files: Folder,
  Computer: Monitor,
  Memory: Brain,
  Routines: Repeat,
  Data: Database,
  Vault: Shield,
  Settings,
};
export function SourceSidePanelHeader({
  openPanes,
  selected,
  onSelect,
  onClose,
  onCollapse,
  maximized,
  onMaximize,
  threads,
}: {
  openPanes: readonly SourcePane[];
  selected: SourcePane | null;
  onSelect: (pane: SourcePane) => void;
  onClose: (pane: SourcePane) => void;
  onCollapse: () => void;
  maximized: boolean;
  onMaximize: () => void;
  threads: Omit<OpenbotSideThreadTabsProps, "children" | "actions" | "maximized">;
}) {
  const closed = panes.filter((pane) => !openPanes.includes(pane));
  return (
    <OpenbotSideThreadTabs
      {...threads}
      maximized={maximized}
      actions={
        <div className="side-panel-actions no-drag">
          {closed.length > 0 && (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className="sidebar-icon-button"
                    aria-label="Add side panel"
                  />
                }
              >
                <Plus />
              </MenuTrigger>
              <MenuPopup align="end">
                {closed.map((pane) => {
                  const Icon = icons[pane];
                  return (
                    <MenuItem key={pane} onClick={() => onSelect(pane)}>
                      <Icon />
                      {pane}
                    </MenuItem>
                  );
                })}
              </MenuPopup>
            </Menu>
          )}
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label={maximized ? "Restore side panel" : "Maximize side panel"}
            aria-pressed={maximized}
            onClick={onMaximize}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </button>
          {maximized && (
            <button
              type="button"
              className="sidebar-icon-button"
              aria-label="Close side panel"
              onClick={onCollapse}
            >
              <PanelRight />
            </button>
          )}
        </div>
      }
    >
      {openPanes.map((pane) => {
        const Icon = icons[pane];
        return (
          <div
            key={pane}
            role="presentation"
            className="side-panel-tab no-drag"
            data-selected={selected === pane ? "true" : undefined}
          >
            <button
              type="button"
              className="side-panel-tab-close"
              tabIndex={-1}
              aria-hidden="true"

              onClick={() => onClose(pane)}
            >
              <span className="side-panel-tab-icon">
                <Icon />
              </span>
              <X className="side-panel-tab-x" />
            </button>
            <button
              type="button"
              role="tab"
              className="side-panel-tab-select"
              aria-selected={selected === pane}
              tabIndex={selected === pane ? 0 : -1}
              onClick={() => onSelect(pane)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(pane);
              }}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  onClose(pane);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const next =
                    openPanes[
                      (openPanes.indexOf(pane) +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        openPanes.length) %
                        openPanes.length
                    ];
                  if (next) onSelect(next);
                }
              }}
            >
              <span className="side-panel-tab-label">{pane}</span>
            </button>
          </div>
        );
      })}
    </OpenbotSideThreadTabs>
  );
}
