/* oxlint-disable shadcn/no-unknown-classes -- OpenBot source selectors are provided by the explicitly imported scoped CSS. */
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

import { renderClosingPositioner } from "~/components/ui/closing-positioner";
import type { MenuPopup as T3MenuPopup } from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { menuMotionRef } from "./openbotMenuMotion";

import "./OpenbotMenu.css";

/** OpenBot action-menu.css on Base UI's accessible menu and mounted exit lifecycle. */
export function MenuPopup({
  children,
  className,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  collisionAvoidance,
  anchor,
  keepMounted = false,
  width = "default",
  ref,
  ...props
}: ComponentProps<typeof T3MenuPopup>) {
  return (
    <MenuPrimitive.Portal keepMounted={keepMounted}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        className="openbot-react openbot-popup-positioner"
        data-slot="menu-positioner"
        data-openbot-positioner=""
        render={renderClosingPositioner}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          {...props}
          ref={menuMotionRef(ref)}
          className={(state) =>
            cn("ui-action-menu", typeof className === "function" ? className(state) : className)
          }
          data-slot="menu-popup"
          data-openbot-width={width}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuSubPopup({
  align = "start",
  alignOffset,
  sideOffset = 0,
  ...props
}: ComponentProps<typeof MenuPopup>) {
  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? (align === "center" ? undefined : -5)}
      side="inline-end"
      sideOffset={sideOffset}
      data-openbot-submenu=""
      {...props}
    />
  );
}
