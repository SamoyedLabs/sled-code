/* oxlint-disable shadcn/no-unknown-classes -- The picker reuses the ported avatar layout inside the shared source popup layer. */
import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cn } from "../../../../lib/utils";
import "../OpenbotMenu.css";
import "./avatar-editor.css";

export function AvatarEditorPopup({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        className="openbot-react openbot-popup-positioner"
        side="bottom"
        sideOffset={11}
        collisionPadding={12}
      >
        <Popover.Popup className={cn("avatar-editor", className)}>
          <Popover.Title className="sr-only">{title}</Popover.Title>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
