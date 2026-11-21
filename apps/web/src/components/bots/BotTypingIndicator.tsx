/* oxlint-disable shadcn/no-unknown-classes -- Scoped typing animation is defined in BotTypingIndicator.css. */
import "./BotTypingIndicator.css";
import { useGT } from "gt-react";
export function BotTypingIndicator({ label: rawLabel }: { label?: string }) {
  const gt = useGT();
  const label = rawLabel ?? gt("Bot is typing");
  return (
    <span className="bot-typing" role="status" aria-label={label}>
      <span aria-hidden="true" className="bot-typing-dot" />
      <span aria-hidden="true" className="bot-typing-dot" />
      <span aria-hidden="true" className="bot-typing-dot" />
    </span>
  );
}
