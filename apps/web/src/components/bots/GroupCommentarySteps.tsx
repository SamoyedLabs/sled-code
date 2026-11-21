/* oxlint-disable shadcn/no-unknown-classes -- Source AgentSteps selectors are defined in group-conversation.css. */
import { useId, useState } from "react";
import { BotIcon, ChevronRightIcon } from "lucide-react";
import type { GroupCommentary } from "./group-conversation";
import { T } from "gt-react";

export function GroupCommentarySteps({
  group,
  reveal,
}: {
  group: GroupCommentary;
  reveal?: { id: string } | null | undefined;
}) {
  const reference = reveal && group.entries.some((entry) => entry.id === reveal.id) ? reveal : null;
  const [choice, setChoice] = useState<{ reference: { id: string } | null; open: boolean }>({
    reference: null,
    open: false,
  });
  const open = choice.reference === reference ? choice.open : reference !== null;
  const id = useId();
  return (
    <div className="ob-group-steps" data-open={open || undefined}>
      <button
        type="button"
        className="ob-group-steps-header"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChoice({ reference, open: !open })}
      >
        <span className="ob-group-steps-summary">
          {group.entries.length} {group.entries.length === 1 ? "step" : "steps"}
        </span>
        <span className="ob-group-step-author">{group.authorName}</span>
        <ChevronRightIcon className="ob-group-steps-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="ob-group-steps-panel">
          <div className="ob-group-steps-viewport">
            <ol id={id}>
              {group.entries.map((entry) => (
                <li key={entry.id} id={`group-message-${entry.id}`}>
                  <BotIcon aria-hidden="true" />
                  <span dir="auto">
                    {entry.message.text}
                    {entry.superseded && (
                      <span className="ob-group-earlier">
                        {" "}
                        <T>Earlier attempt</T>
                      </span>
                    )}
                    {entry.message.status !== "completed" && (
                      <span className="ob-chat-message-status"> {entry.message.status}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
