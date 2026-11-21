/* oxlint-disable shadcn/no-unknown-classes -- Original SidebarPeopleSection selectors live in scoped source CSS. */
import type { DragEvent, CSSProperties } from "react";
import type { OpenbotPerson, OpenbotDirectThread } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { SourcePersonAvatar } from "./SourcePersonAvatar";
import { personName } from "./directModel";
import type { SidebarDragSource } from "./openbotSidebarDrag";
import "./People.css";
import { T, Var, useGT } from "gt-react";
export type SidebarPeople = {
  members: readonly OpenbotPerson[];
  selfId: string | null;
  threads: readonly OpenbotDirectThread[];
  selected: string | null;
  onSelect: (id: string) => void;
};
function personTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function SidebarPeopleSection({
  people,
  closed,
  mutable,
  toggle,
  onMove,
  onStartDrag,
  onEndDrag,
  offsets,
  draggingId,
}: {
  people: SidebarPeople;
  closed: boolean;
  mutable: boolean;
  toggle: () => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onStartDrag: (event: DragEvent<HTMLElement>, source: SidebarDragSource) => void;
  onEndDrag: () => void;
  offsets: Readonly<Record<string, { x: number; y: number }>>;
  draggingId: string | null;
}) {
  const gt = useGT();
  const threads = new Map(people.threads.map((thread) => [thread.otherMemberId, thread]));
  return (
    <section
      className="sidebar-chat-group sidebar-section"
      data-section-id="people"
      aria-label={gt("People")}
    >
      <header>
        <button
          type="button"
          className="sidebar-section-toggle sidebar-section-drag-handle"
          aria-expanded={!closed}
          aria-controls="sidebar-section-body-people"
          onClick={toggle}
          draggable={mutable}
          onDragStart={(event) => onStartDrag(event, { kind: "section", id: "people" })}
          onDragEnd={onEndDrag}
        >
          <span className="sidebar-section-name">
            <T>People</T>
          </span>
          <ChevronDownIcon
            className={`sidebar-section-chevron${closed ? " sidebar-section-chevron-collapsed" : ""}`}
          />
        </button>
      </header>
      <div
        className="sidebar-section-collapse"
        data-collapsed={closed ? "" : undefined}
        aria-hidden={closed || undefined}
        inert={closed}
      >
        <div className="sidebar-section-body" id="sidebar-section-body-people">
          {people.members.map((member) => {
            const thread = threads.get(member.id),
              unread = thread?.unreadCount ?? 0;
            const preview = thread?.lastMessage.text ?? (member.online ? "Online" : "Offline");
            return (
              <div
                key={member.id}
                className={`sidebar-person-item${draggingId === member.id ? " sidebar-person-item-dragging" : ""}${offsets[member.id]?.y ? " sidebar-drag-shifting" : ""}`}
                style={{ "--sidebar-drag-y": `${offsets[member.id]?.y ?? 0}px` } as CSSProperties}
                data-person-id={member.id}
                draggable
                onDragStart={(event) =>
                  onStartDrag(event, { kind: "person", id: member.id, origin: "people" })
                }
                onDragEnd={onEndDrag}
              >
                <button
                  type="button"
                  className={`agent-row person-row${people.selected === member.id ? " agent-row-active" : ""}`}
                  aria-label={`${personName(member)}. ${preview}`}
                  aria-pressed={people.selected === member.id}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onClick={() => people.onSelect(member.id)}
                  onKeyDown={(event) => {
                    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                      event.preventDefault();
                      onMove(member.id, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                >
                  <span className="agent-row-avatar">
                    <SourcePersonAvatar member={member} />
                    {unread > 0 && (
                      <span className="person-unread-badge" aria-hidden="true">
                        {Math.min(unread, 99)}
                      </span>
                    )}
                  </span>
                  <span className="agent-row-copy">
                    <span className="agent-row-heading">
                      <strong>{personName(member)}</strong>
                      <span>{personTime(thread?.updatedAt)}</span>
                    </span>
                    <span className="agent-row-preview">{preview}</span>
                  </span>
                  {unread > 0 && (
                    <span className="sr-only">
                      <T>
                        <Var>{unread}</Var> unread messages
                      </T>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
