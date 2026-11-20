/* oxlint-disable shadcn/no-unknown-classes -- Original PageRail selectors are supplied by the scoped source CSS. */
import { useState, type ComponentType, type ReactNode } from "react";
import {
  BotIcon,
  WorkflowIcon,
  WaypointsIcon,
  ListChecksIcon,
  CalendarClockIcon,
  ChartAreaIcon,
  StoreIcon,
  CircleHelpIcon,
  SettingsIcon,
  EllipsisIcon,
  PinIcon,
  BookOpenIcon,
  GiftIcon,
} from "lucide-react";
import { Menu as Primitive } from "@base-ui/react/menu";
import { Menu, MenuTrigger, MenuItem, MenuSeparator } from "../../ui/menu";
import { MenuPopup } from "./OpenbotMenu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./OpenbotTooltip";
import type { BotWorkspaceSection } from "../BotWorkspaceChrome";
const pages = [
  { id: "flows", label: "Routines", icon: WorkflowIcon },
  { id: "workflows", label: "Workflows", icon: WaypointsIcon },
  { id: "tasks", label: "Tasks", icon: ListChecksIcon },
  { id: "schedule", label: "Schedule", icon: CalendarClockIcon },
  { id: "usage", label: "Usage", icon: ChartAreaIcon },
] as const;
type Pinned = (typeof pages)[number]["id"];
const key = "sled.openbot.rail-pins.v1";
function readPins(): readonly Pinned[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(value)) return pages.filter((p) => value.includes(p.id)).map((p) => p.id);
  } catch {
    /* Use upstream defaults when preferences are unavailable. */
  }
  return ["workflows", "tasks", "usage"];
}
function RailButton({
  label,
  icon: Icon,
  current,
  onClick,
}: {
  label: string;
  icon: ComponentType;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="window-rail-button"
            aria-label={label}
            aria-current={current ? "page" : undefined}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}
/** Source PageRail order/default pins; existing guarded React pages own destination actions. */
export function OpenbotPageRail({
  section,
  onSection,
  usageRings,
}: {
  usageRings?: ReactNode;
  section: BotWorkspaceSection;
  onSection: (section: BotWorkspaceSection) => void;
}) {
  const [pinned, setPinned] = useState(readPins);
  const pin = (id: Pinned, checked: boolean) =>
    setPinned((current) => {
      const next = pages
        .filter((p) => (p.id === id ? checked : current.includes(p.id)))
        .map((p) => p.id);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* In-memory preferences still work. */
      }
      return next;
    });
  return (
    <nav aria-label="Bot navigation" className="window-rail">
      <div className="window-rail-group">
        <RailButton
          label="Agents"
          icon={BotIcon}
          current={section === "chats" || section === "groups" || section === "direct"}
          onClick={() => onSection("chats")}
        />
        {pages
          .filter((p) => pinned.includes(p.id))
          .map((p) => (
            <RailButton
              key={p.id}
              label={p.label}
              icon={p.icon}
              current={section === p.id}
              onClick={() => onSection(p.id)}
            />
          ))}
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="window-rail-button"
                aria-label="More pages"
                aria-current={
                  pages.some((p) => p.id === section && !pinned.includes(p.id)) ? "page" : undefined
                }
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup
            side="right"
            align="start"
            sideOffset={10}
            className="window-rail-more-menu"
            aria-label="More pages"
          >
            {pages.map((p) => (
              <div
                key={p.id}
                role="none"
                className="window-rail-more-row"
                data-pinned={pinned.includes(p.id) ? "" : undefined}
              >
                <MenuItem onClick={() => onSection(p.id)}>
                  <p.icon />
                  <span>{p.label}</span>
                </MenuItem>
                <Primitive.CheckboxItem
                  className="window-rail-more-pin"
                  closeOnClick={false}
                  checked={pinned.includes(p.id)}
                  onCheckedChange={(checked) => pin(p.id, checked)}
                  aria-label={`Pin ${p.label}`}
                >
                  <PinIcon className="agent-context-icon" />
                </Primitive.CheckboxItem>
              </div>
            ))}
            <MenuSeparator />
            <MenuItem onClick={() => onSection("groups")}>Groups</MenuItem>
            <MenuItem onClick={() => onSection("attention")}>Needs attention</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="window-rail-group">
        {usageRings}
        <RailButton
          label="Marketplace"
          icon={StoreIcon}
          current={section === "marketplace"}
          onClick={() => onSection("marketplace")}
        />
        <Menu>
          <MenuTrigger
            render={<button type="button" className="window-rail-button" aria-label="Help" />}
          >
            <CircleHelpIcon />
          </MenuTrigger>
          <MenuPopup side="right" align="end" sideOffset={10} aria-label="Help">
            <MenuItem
              render={
                <a href="https://openbot.run/changelog" target="_blank" rel="noopener noreferrer" />
              }
            >
              <GiftIcon />
              Changelog
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              render={
                <a href="https://openbot.run/guides" target="_blank" rel="noopener noreferrer" />
              }
            >
              <BookOpenIcon />
              Guides
            </MenuItem>
            <MenuItem
              render={
                <a href="https://discord.openbot.run" target="_blank" rel="noopener noreferrer" />
              }
            >
              Discord community
            </MenuItem>
          </MenuPopup>
        </Menu>
        <RailButton
          label="Settings"
          icon={SettingsIcon}
          current={section === "settings"}
          onClick={() => onSection("settings")}
        />
      </div>
    </nav>
  );
}
