import { useGT } from "gt-react";
import type { DeviceServiceState, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Columns2, Grid2X2, Plus, Minimize2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { AndroidIcon, AppleIcon } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { deviceEnvironment } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatEnvironmentQueryError } from "~/state/query";
import { DeviceWorkspace } from "./DeviceWorkspace";
import { deviceWorkspaceKey, useDeviceWorkspaceStore } from "./deviceWorkspaceStore";

export function DeviceGrid({
  state,
  threadRef,
  visible,
}: {
  readonly state: DeviceServiceState;
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const gt = useGT();
  const workspace = useDeviceWorkspaceStore(
    (value) => value.byThreadKey[scopedThreadKey(threadRef)],
  );
  const [error, setError] = useState<string | null>(null);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const close = useAtomCommand(deviceEnvironment.close);
  if (!workspace) return null;
  const setWorkspace = (
    ref: ScopedThreadRef,
    patch: Parameters<ReturnType<typeof useDeviceWorkspaceStore.getState>["update"]>[1],
  ) => useDeviceWorkspaceStore.getState().update(ref, patch);
  const opened = state.sessions.filter((session) => session.threadId === threadRef.threadId);
  const devices = state.devices.filter(
    (device) =>
      opened.some(
        (session) => session.hostId === device.hostId && session.deviceId === device.id,
      ) && !workspace.hidden.includes(deviceWorkspaceKey(device.hostId, device.id)),
  );
  const selectedIndex = devices.findIndex(
    (device) => deviceWorkspaceKey(device.hostId, device.id) === workspace.selected,
  );
  const currentPage = Math.floor(Math.max(0, selectedIndex) / 4);
  const tiles = devices.slice(currentPage * 4, currentPage * 4 + 4);
  const selected =
    tiles.find((device) => deviceWorkspaceKey(device.hostId, device.id) === workspace.selected) ??
    tiles[0];
  const focus = workspace.mode === "focus" && tiles.length > 1;
  const revealHidden = () => {
    const first = state.devices.find((device) =>
      opened.some((session) => session.hostId === device.hostId && session.deviceId === device.id),
    );
    setWorkspace(threadRef, {
      hidden: [],
      selected: workspace.selected ?? (first ? deviceWorkspaceKey(first.hostId, first.id) : null),
    });
  };
  const hide = (key: string) => {
    const next = devices.find((device) => deviceWorkspaceKey(device.hostId, device.id) !== key);
    setWorkspace(threadRef, {
      hidden: [...workspace.hidden, key],
      ...(selected && deviceWorkspaceKey(selected.hostId, selected.id) === key
        ? { selected: next ? deviceWorkspaceKey(next.hostId, next.id) : null }
        : {}),
    });
  };
  return (
    <div className="@container flex min-h-0 flex-1 flex-col" data-device-workspace>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <ToggleGroup
          aria-label={gt("Device layout")}
          value={[workspace.mode]}
          onValueChange={(next) => {
            const mode = next[0];
            if (mode === "grid" || mode === "focus") setWorkspace(threadRef, { mode });
          }}
        >
          <ToggleGroupItem value="grid">
            <span className="flex items-center gap-1.5">
              <Grid2X2 className="size-3.5" />
              {gt("Grid")}
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem value="focus">
            <span className="flex items-center gap-1.5">
              <Columns2 className="size-3.5" />
              {gt("Focus")}
            </span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-1.5">
          <Button
            size="compact"
            variant="ghost"
            onClick={() => setWorkspace(threadRef, { picker: true })}
          >
            <span className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              {gt("Add device")}
            </span>
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={gt("Return to single device")}
                  onClick={() => {
                    if (selected)
                      useRightPanelStore.getState().openDevice(threadRef, {
                        hostId: selected.hostId,
                        deviceId: selected.id,
                        platform: selected.platform,
                        name: selected.name,
                      });
                    useDeviceWorkspaceStore.getState().leave(threadRef);
                  }}
                />
              }
            >
              <Minimize2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{gt("Return to single device")}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {tiles.length ? (
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-px overflow-auto bg-border/60",
            focus
              ? "grid-cols-[minmax(0,1fr)_120px] @min-[440px]:grid-cols-[minmax(0,1fr)_136px]"
              : tiles.length === 1
                ? "grid-cols-1"
                : "grid-cols-2",
            !focus &&
              (tiles.length > 2
                ? "grid-rows-[repeat(2,minmax(176px,1fr))] @min-[560px]:grid-rows-[repeat(2,minmax(240px,1fr))]"
                : "grid-rows-[minmax(220px,1fr)]"),
          )}
          style={
            focus
              ? { gridTemplateRows: `repeat(${tiles.length - 1}, minmax(112px, 1fr))` }
              : undefined
          }
        >
          {tiles.map((device, index) => {
            const key = deviceWorkspaceKey(device.hostId, device.id);
            const active = device === selected;
            const host = state.hosts.find((candidate) => candidate.id === device.hostId);
            const thumbnail = focus && !active;
            const otherIndex = tiles.filter((candidate) => candidate !== selected).indexOf(device);
            return (
              <section
                key={key}
                aria-label={`${device.name} preview`}
                data-active-preview={active || undefined}
                className={cn(
                  "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
                  active ? "bg-background" : "bg-muted/30",
                  !focus && tiles.length === 3 && index === 2 && "col-span-2",
                )}
                style={
                  focus
                    ? active
                      ? { gridColumn: 1, gridRow: `1 / span ${tiles.length - 1}` }
                      : { gridColumn: 2, gridRow: otherIndex + 1 }
                    : undefined
                }
              >
                <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-background px-2">
                  <Toggle
                    variant="ghost"
                    size="compact"
                    className="min-w-0 flex-1 justify-start"
                    pressed={active}
                    title={`${device.name} · ${host?.label ?? "Device host"} · ${device.version}`}
                    onPressedChange={() => setWorkspace(threadRef, { selected: key })}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 px-1">
                      {thumbnail ? null : (
                        <span className="grid size-4 shrink-0 place-items-center">
                          {device.platform === "ios" ? (
                            <AppleIcon className="size-3" />
                          ) : (
                            <AndroidIcon className="size-3" />
                          )}
                        </span>
                      )}
                      <span
                        className={
                          thumbnail
                            ? "line-clamp-2 whitespace-normal text-left text-2xs leading-tight"
                            : "truncate"
                        }
                      >
                        {device.name}
                      </span>
                    </span>
                  </Toggle>
                  {!thumbnail ? (
                    <span className="hidden shrink-0 text-2xs tabular-nums text-muted-foreground @min-[560px]:inline">
                      {device.version}
                    </span>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={gt("Hide {name} preview", { name: device.name })}
                          onClick={() => hide(key)}
                        />
                      }
                    >
                      <X className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup>{gt("Hide preview")}</TooltipPopup>
                  </Tooltip>
                </div>
                <div className="relative flex min-h-0 flex-1" inert={!active}>
                  <DeviceWorkspace
                    environmentId={threadRef.environmentId}
                    device={device}
                    hostLabel={host?.label ?? gt("Device host")}
                    hostKind={host?.kind}
                    hostDiagnostics={undefined}
                    visible={visible}
                    interactive={active}
                    controlsHost={controlsHost}
                    defaultPresentation="flat"
                    onFloat={() => {
                      usePreviewMiniPlayerStore.getState().open(threadRef, {
                        kind: "device",
                        hostId: device.hostId,
                        deviceId: device.id,
                        platform: device.platform,
                        name: device.name,
                      });
                      useRightPanelStore.getState().close(threadRef);
                      useDeviceWorkspaceStore.getState().leave(threadRef);
                    }}
                    onClose={() => hide(key)}
                    onPowerOff={() => {
                      void close({
                        environmentId: threadRef.environmentId,
                        input: {
                          threadId: threadRef.threadId,
                          hostId: device.hostId,
                          deviceId: device.id,
                          shutdown: true,
                        },
                      }).then((result) => {
                        if (result._tag === "Failure")
                          setError(formatEnvironmentQueryError(result.cause));
                        else {
                          const next = devices.find((candidate) => candidate !== device);
                          setWorkspace(threadRef, {
                            selected: next ? deviceWorkspaceKey(next.hostId, next.id) : null,
                          });
                        }
                      });
                    }}
                  />
                </div>
                {!active ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute inset-x-0 bottom-0 top-9 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={gt("Control {name}", { name: device.name })}
                    onClick={() => setWorkspace(threadRef, { selected: key })}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <p>
            {opened.length ? gt("All previews are hidden.") : gt("Open a device to see it here.")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              opened.length ? revealHidden() : setWorkspace(threadRef, { picker: true })
            }
          >
            {opened.length ? gt("Show hidden previews") : gt("Add device")}
          </Button>
        </div>
      )}
      <div ref={setControlsHost} hidden={!selected} className="shrink-0 border-t bg-background" />
      {workspace.hidden.length || devices.length > 4 ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
          {workspace.hidden.length ? (
            <Button size="xs" variant="ghost" onClick={revealHidden}>
              {gt("Show hidden")}
            </Button>
          ) : null}
          {devices.length > 4 ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Previous devices")}
                disabled={currentPage === 0}
                onClick={() => {
                  const device = devices[(currentPage - 1) * 4];
                  if (device)
                    setWorkspace(threadRef, {
                      selected: deviceWorkspaceKey(device.hostId, device.id),
                    });
                }}
              >
                <ChevronLeft />
              </Button>
              <span className="tabular-nums">
                {currentPage + 1} / {Math.ceil(devices.length / 4)}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Next devices")}
                disabled={(currentPage + 1) * 4 >= devices.length}
                onClick={() => {
                  const device = devices[(currentPage + 1) * 4];
                  if (device)
                    setWorkspace(threadRef, {
                      selected: deviceWorkspaceKey(device.hostId, device.id),
                    });
                }}
              >
                <ChevronRight />
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
