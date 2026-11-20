/* oxlint-disable shadcn/no-unknown-classes -- OpenBot source selectors are provided by the explicitly imported scoped CSS. */
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { createContext, use, useId, type ComponentProps } from "react";

import { renderClosingPositioner } from "~/components/ui/closing-positioner";
import type { TooltipPopup as T3TooltipPopup } from "~/components/ui/tooltip";
import { Tooltip as T3Tooltip, TooltipTrigger as T3TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useNativeTitlebarHeight } from "~/lib/windowControlsOverlay";
import { menuMotionRef } from "./openbotMenuMotion";

import "./OpenbotMenu.css";

const TooltipMotionContext = createContext<string | undefined>(undefined);

export function Tooltip<Payload>(props: TooltipPrimitive.Root.Props<Payload>) {
  const id = useId();
  return (
    <TooltipMotionContext value={id}>
      <T3Tooltip {...props} />
    </TooltipMotionContext>
  );
}

export function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={150} closeDelay={0} timeout={300} {...props} />;
}

export function TooltipTrigger(props: ComponentProps<typeof T3TooltipTrigger>) {
  const id = use(TooltipMotionContext);
  return (
    <T3TooltipTrigger
      delay={150}
      closeDelay={0}
      aria-describedby={id}
      data-openbot-tooltip-trigger={id}
      {...props}
    />
  );
}

/** OpenBot's label surface and exact submenu reveal; Base UI owns focus and dismissal. */
export function TooltipPopup({
  className,
  align = "center",
  sideOffset = 10,
  side = "right",
  variant: _variant,
  anchor,
  children,
  ref,
  ...props
}: ComponentProps<typeof T3TooltipPopup>) {
  const id = use(TooltipMotionContext);
  const fallbackId = useId();
  const titlebarHeight = useNativeTitlebarHeight();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="openbot-react openbot-popup-positioner openbot-tooltip-positioner"
        align={align}
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        render={renderClosingPositioner}
        collisionPadding={{ top: 5 + titlebarHeight, right: 5, bottom: 5, left: 5 }}
        data-slot="tooltip-positioner"
        data-openbot-positioner=""
      >
        <TooltipPrimitive.Popup
          id={id ?? fallbackId}
          role="tooltip"
          {...props}
          ref={menuMotionRef(ref, true)}
          className={(state) => {
            const surface = typeof className === "function" ? className(state) : className;
            return cn("ui-motion-tooltip", !surface && "ui-motion-tooltip-label", surface);
          }}
          data-slot="tooltip-popup"
          data-openbot-tooltip-owner={id}
        >
          {className ? children : <span>{children}</span>}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
