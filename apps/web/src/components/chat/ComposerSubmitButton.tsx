import type { ComponentProps } from "react";
import { StageBackdropButtonArt } from "../SidebarStageBackdrop";
import { cn } from "~/lib/utils";

/** Shared message action for Threads and Bots. Dispatch remains with the owning composer. */
export function ComposerSubmitButton({
  backdropVariant,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  backdropVariant?: ComponentProps<typeof StageBackdropButtonArt>["variant"] | null;
}) {
  return (
    <button
      type="submit"
      className={cn(
        "relative isolate flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-control-highlight hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8 [&_svg]:pointer-events-none",
        backdropVariant
          ? "bg-transparent text-white enabled:shadow-black/24 enabled:hover:brightness-110 disabled:opacity-64"
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover disabled:bg-foreground/12 disabled:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {backdropVariant ? (
        <span className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={backdropVariant} />
        </span>
      ) : null}
      {children}
    </button>
  );
}

export function ComposerSendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
