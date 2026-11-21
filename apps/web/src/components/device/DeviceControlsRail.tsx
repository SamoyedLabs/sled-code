import { useGT } from "gt-react";
import type { DeviceHostSummary, DevicePlatform } from "@t3tools/contracts";
import {
  Camera,
  ChevronLeft,
  Home,
  Keyboard,
  Box,
  Maximize,
  MoreHorizontal,
  PictureInPicture2,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Square,
  Type,
  X,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { DeviceStreamHandle, DeviceViewControls } from "./DeviceStreamView";
import type { DeviceControls } from "./useDeviceControls";

export function DeviceControlsRail(props: {
  platform: DevicePlatform;
  hostKind: DeviceHostSummary["kind"] | undefined;
  handle: DeviceStreamHandle | null;
  view: DeviceViewControls;
  controls: DeviceControls;
  screenshotPending: boolean;
  onScreenshot: () => void;
  toolsOpen: boolean;
  onTools: () => void;
  onFloat: () => void;
  onClose: () => void;
  onPowerOff: () => void;
  controlsHost?: HTMLElement | null | undefined;
}) {
  const gt = useGT();
  const { view, handle, controls } = props;
  const docked = props.controlsHost !== undefined;
  const popupSide = docked ? "top" : "left";
  const settings = controls.detail?.settings;
  const inputDisabled = !handle?.inputConnected;
  const runsHostCommands = props.hostKind === "local" || props.hostKind === "ssh";
  const nextAppearance = settings?.appearance === "dark" ? "light" : "dark";
  const actions = (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-1",
        docked
          ? "flex-wrap justify-center gap-x-1.5 gap-y-2 px-2 py-1.5 pointer-coarse:gap-x-4 pointer-coarse:gap-y-4"
          : "shrink-0 flex-col rounded-full border border-border/50 bg-background/80 p-2 shadow-sm",
      )}
    >
      <RailButton
        tooltipSide={popupSide}
        label="Home"
        disabled={inputDisabled}
        onClick={() => handle?.pressButton("home")}
      >
        <Home className="size-4" />
      </RailButton>
      {props.platform === "android" ? (
        <>
          <RailButton
            tooltipSide={popupSide}
            label={gt("Back")}
            disabled={inputDisabled}
            onClick={() => handle?.pressButton("back")}
          >
            <ChevronLeft className="size-4" />
          </RailButton>
          <RailButton
            tooltipSide={popupSide}
            label={gt("Recents")}
            disabled={inputDisabled}
            onClick={() => handle?.pressButton("recents")}
          >
            <Square className="size-4" />
          </RailButton>
          {runsHostCommands ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={gt("Rotate device")}
                    disabled={controls.disabled}
                  />
                }
              >
                <RotateCcw className="size-4" />
              </MenuTrigger>
              <MenuPopup side={popupSide}>
                <MenuItem
                  onClick={() => void controls.act({ type: "setOrientation", value: "portrait" })}
                >
                  {gt("Portrait")}
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    void controls.act({ type: "setOrientation", value: "landscape_left" })
                  }
                >
                  {gt("Landscape")}
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </>
      ) : props.hostKind === "simlock" ? null : (
        <RailButton
          tooltipSide={popupSide}
          label={gt("Rotate device")}
          disabled={inputDisabled || !!view.keyboard?.attached}
          onClick={() => handle?.rotate()}
        >
          <RotateCcw className="size-4" />
        </RailButton>
      )}
      {runsHostCommands ? (
        <>
          {docked ? null : <RailDivider />}
          <RailButton
            tooltipSide={popupSide}
            label={gt("Switch device to {nextAppearance} mode", { nextAppearance })}
            disabled={controls.disabled || !settings?.appearance}
            onClick={() => void controls.act({ type: "setAppearance", value: nextAppearance })}
          >
            {settings?.appearance === "dark" ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )}
          </RailButton>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={gt("Device text size")}
                  title={gt("Device text size")}
                  disabled={controls.disabled || !settings?.textSize}
                />
              }
            >
              <Type className="size-4" />
            </MenuTrigger>
            <MenuPopup side={popupSide} className="min-w-40">
              <MenuRadioGroup
                value={settings?.textSize ?? ""}
                onValueChange={(value) => {
                  if (
                    value === "small" ||
                    value === "default" ||
                    value === "large" ||
                    value === "extra-large"
                  )
                    void controls.act({ type: "setTextSize", value });
                }}
              >
                {(
                  [
                    ["small", "Small"],
                    ["default", "Default"],
                    ["large", "Large"],
                    ["extra-large", "Extra large"],
                  ] as const
                ).map(([value, label]) => (
                  <MenuRadioItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      <span className="flex-1">{label}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
          <RailButton
            tooltipSide={popupSide}
            label={gt("Device tools")}
            pressed={props.toolsOpen}
            onClick={props.onTools}
          >
            <SlidersHorizontal className="size-4" />
          </RailButton>
        </>
      ) : null}
      {props.hostKind === "simlock" ? null : (
        <RailButton
          tooltipSide={popupSide}
          label={props.screenshotPending ? gt("Capturing screenshot") : gt("Save screenshot")}
          disabled={!view.streaming || props.screenshotPending}
          onClick={props.onScreenshot}
        >
          <Camera className="size-4" />
        </RailButton>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={gt("More device actions")}
              title={gt("More device actions")}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </MenuTrigger>
        <MenuPopup side={popupSide} align="end">
          <MenuItem onClick={props.onFloat}>
            <PictureInPicture2 />
            {gt("Float device over chat")}
          </MenuItem>
          <MenuItem onClick={props.onClose}>
            <X />
            {docked ? gt("Hide preview") : gt("Close device panel")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={props.onPowerOff}>
            <Power />
            {props.hostKind === "simlock"
              ? gt("Return device to the pool")
              : gt("Power off device")}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {docked ? null : <RailDivider />}
      <RailButton
        tooltipSide={popupSide}
        label={gt("3D view")}
        pressed={view.phone}
        disabled={!view.streaming || !!view.phoneUnavailableReason}
        description={view.phoneUnavailableReason ?? undefined}
        onClick={view.showPhone}
      >
        <Box className="size-4" />
      </RailButton>
      <RailButton
        tooltipSide={popupSide}
        label={gt("Flat view")}
        pressed={!view.phone}
        disabled={!view.streaming}
        onClick={view.showFlat}
      >
        <Smartphone className="size-4" />
      </RailButton>
      {view.keyboard ? (
        <RailButton
          tooltipSide={popupSide}
          label={view.keyboard.attached ? gt("Detach Magic Keyboard") : gt("Attach Magic Keyboard")}
          pressed={view.keyboard.attached}
          onClick={view.keyboard.toggle}
        >
          <Keyboard className="size-4" />
        </RailButton>
      ) : null}
      {view.phone ? (
        <RailButton tooltipSide={popupSide} label={gt("Restore 3D view")} onClick={view.resetView}>
          <Maximize className="size-4" />
        </RailButton>
      ) : null}
    </div>
  );
  return (
    <>
      {props.controlsHost
        ? createPortal(
            <div role="group" aria-label={gt("Device controls")}>
              {actions}
            </div>,
            props.controlsHost,
          )
        : null}
      {!docked || view.foldingControls ? (
        <aside
          aria-label={docked ? gt("Device folding controls") : gt("Device controls")}
          data-layout="rail"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-14 flex-col items-center gap-2 overflow-y-auto [justify-content:safe_center] py-3 pr-2 [scrollbar-width:none]"
        >
          {docked ? null : actions}
          {view.foldingControls}
        </aside>
      ) : null}
    </>
  );
}

function RailDivider() {
  return <div aria-hidden className="my-1 h-px w-5 shrink-0 bg-border/70" />;
}

function RailButton(props: {
  tooltipSide: "left" | "top";
  label: string;
  description?: string | undefined;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      size="icon-sm"
      variant={props.pressed ? "secondary" : "ghost"}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
  return (
    <Tooltip>
      {props.disabled && props.description ? (
        <TooltipTrigger
          render={
            <span className="inline-flex" tabIndex={0} role="group" aria-label={props.label} />
          }
        >
          {button}
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={button} />
      )}
      <TooltipPopup side={props.tooltipSide}>{props.description ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}
