// Adapted from Vercel AI Elements (Apache-2.0). Registry provenance: .t3/bots-ui-refresh/vercel-reference/install-manifest.json
"use client";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col gap-8 p-4", className)} {...props} />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = () => {
    scrollToBottom();
  };

  return (
    !isAtBottom && (
      <Button
        className={cn("absolute bottom-4 left-1/2 translate-x-[-50%] ", className)}
        onClick={handleScrollToBottom}
        size="icon-sm"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
