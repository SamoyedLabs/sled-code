// Message layout primitives from Vercel AI Elements (Apache-2.0).
// Only the layout/action-container exports are needed by the isolated alternative.
import { cn } from "~/lib/utils";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "ml-auto justify-end" : "",
      className,
    )}
    data-from={from}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-data-[from=user]:ml-auto group-data-[from=user]:rounded-2xl group-data-[from=user]:rounded-tr-md group-data-[from=user]:bg-primary group-data-[from=user]:px-4 group-data-[from=user]:py-3 group-data-[from=user]:text-primary-foreground",
      "group-data-[from=assistant]:rounded-2xl group-data-[from=assistant]:rounded-tl-md group-data-[from=assistant]:border group-data-[from=assistant]:border-border/60 group-data-[from=assistant]:bg-card group-data-[from=assistant]:px-4 group-data-[from=assistant]:py-3 group-data-[from=assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);
