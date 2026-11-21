// Exact OpenBot 0.60.0 English agent setup messages.
import { m } from "../../../../i18n/messages";
import { msg } from "gt-react";
const messages: Record<string, string> = {
  "agent.setup.nameFallback": "New agent",
  "agent.setup.titleAdditional": "Create a new agent",
  "agent.setup.titleFirst": "Create your first agent",
  "agent.setup.color": "Agent color",
  "agent.setup.colorAutomatic": "Automatic agent color",
  "agent.setup.colorOption": "{color} agent color",
  "agent.setup.face": "Agent face",
  "agent.setup.faceOption": "Agent face {number}",
  "agent.setup.name": "Name",
  "agent.setup.purpose": "What should this agent help with?",
  "agent.setup.purposePlaceholder": m(
    msg("Plan trips, compare options, or help with everyday work."),
  ),
  "agent.description.tooLong":
    "Shorten the description to {limit} characters. A longer description is not saved.",
  "agent.instructions.length": "{length} / {limit}",
  "agent.instructions.tooLong":
    "Shorten the instructions to {limit} characters. Longer instructions are not saved.",
  "agent.setup.model": "Agent model",
  "agent.setup.creating": "Creating agent\u2026",
  "agent.setup.create": "Create agent",
  "agent.setup.suggestions": "Suggestions",
  "agent.setup.suggestion.label": "{name}. {description}",
  "agent.setup.suggestion.inboxHelper.name": "Inbox Helper",
  "agent.setup.suggestion.inboxHelper.description":
    "Drafts replies and keeps follow-ups from slipping.",
  "agent.setup.suggestion.inboxHelper.purpose":
    "Draft clear email replies in my voice, summarize long threads, and keep track of follow-ups.",
  "agent.setup.suggestion.tripPlanner.name": "Trip Planner",
  "agent.setup.suggestion.tripPlanner.description":
    "Compares options and builds practical itineraries.",
  "agent.setup.suggestion.tripPlanner.purpose":
    "Compare travel options and turn my rough ideas into practical, day-by-day itineraries.",
  "agent.setup.suggestion.personalOrganizer.name": "Personal Organizer",
  "agent.setup.suggestion.personalOrganizer.description":
    "Turns notes, errands, and tasks into a simple plan.",
  "agent.setup.suggestion.personalOrganizer.purpose":
    "Organize my notes, errands, and loose tasks into clear priorities and simple next steps.",
  "agent.setup.suggestion.shoppingScout.name": "Shopping Scout",
  "agent.setup.suggestion.shoppingScout.description":
    "Compares products, prices, and reviews before I buy.",
  "agent.setup.suggestion.shoppingScout.purpose":
    "Compare products, prices, and reviews so I can make practical buying decisions with less research.",
  "agent.setup.suggestion.writingPartner.name": "Writing Partner",
  "agent.setup.suggestion.writingPartner.description":
    "Drafts messages and documents in a natural voice.",
  "agent.setup.suggestion.writingPartner.purpose":
    "Help me draft and improve messages and documents while keeping the writing clear and natural.",
  "agent.setup.suggestion.learningCoach.name": "Learning Coach",
  "agent.setup.suggestion.learningCoach.description":
    "Explains difficult topics and builds study plans.",
  "agent.setup.suggestion.learningCoach.purpose":
    "Explain difficult topics clearly and build study plans that match my pace and goals.",
  "agent.color.red": "Red",
  "agent.color.orange": "Orange",
  "agent.color.yellow": "Yellow",
  "agent.color.lime": "Lime",
  "agent.color.green": "Green",
  "agent.color.cyan": "Cyan",
  "agent.color.blue": "Blue",
  "agent.color.indigo": "Indigo",
  "agent.color.violet": "Violet",
  "agent.color.magenta": "Magenta",
};
export function t(key: string, values: Record<string, string | number> = {}) {
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  );
}
