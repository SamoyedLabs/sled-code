/* oxlint-disable shadcn/no-unknown-classes -- Scoped typing animation is defined in BotTypingIndicator.css. */
import "./BotTypingIndicator.css";
export function BotTypingIndicator({ label = "Bot is typing" }: { label?: string }) {
  return (
    <span className="bot-typing" role="status" aria-label={label}>
      <span aria-hidden="true" className="bot-typing-dot" />
      <span aria-hidden="true" className="bot-typing-dot" />
      <span aria-hidden="true" className="bot-typing-dot" />
    </span>
  );
}
