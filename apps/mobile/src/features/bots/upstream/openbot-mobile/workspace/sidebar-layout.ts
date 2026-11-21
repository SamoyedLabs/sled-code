// Adapted from OpenBot iOS 1.4.11's features/workspace/model/sidebar-layout.ts.
// A chat carries Sled's presentation data instead of the standalone app's MobileAgent.
import {
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderPath,
  sidebarFolderTreeOrder,
  type SidebarLayoutSnapshot,
} from "./sidebar-folders";

export const SIDEBAR_UNASSIGNED_SECTION_ID = "unassigned";
export const MOBILE_CHAT_ORDERS = ["manual", "recent", "unread-group", "unread-first"] as const;
export type MobileChatOrder = (typeof MOBILE_CHAT_ORDERS)[number];

type SidebarChat = {
  pin: { id: string };
  updatedAt?: string | null | undefined;
  unread: number;
  needsInput: boolean;
};

type Section = {
  id: string;
  name: string;
  parentId: string | null;
  ancestorIds: readonly string[];
  collapsed: boolean;
};

export type SidebarEntry<Chat> =
  | { kind: "section"; section: Section }
  | { kind: "chat"; chat: Chat; sectionId: string | null };

/** Recent and unread-first sorting have no manual chat drop positions. */
export function mobileChatOrderSortsSections(order: MobileChatOrder): boolean {
  return order === "recent" || order === "unread-first";
}

const activity = ({ updatedAt }: SidebarChat) => Date.parse(updatedAt ?? "") || 0;

export function mobileSidebarRows<Chat extends SidebarChat>(
  layout: SidebarLayoutSnapshot | null,
  input: readonly Chat[],
  collapsed: ReadonlySet<string>,
  order: MobileChatOrder,
) {
  const positions = new Map(layout?.agentOrder.map((id, index) => [id, index]));
  const manual = [...input].sort(
    (a, b) =>
      (positions.get(a.pin.id) ?? positions.size) - (positions.get(b.pin.id) ?? positions.size),
  );
  const waiting = manual.filter((item) => item.needsInput);
  const regular = manual.filter((item) => !item.needsInput);
  const byRecent = (a: Chat, b: Chat) => activity(b) - activity(a);
  const unread =
    order === "unread-group" ? regular.filter(({ unread }) => unread > 0).sort(byRecent) : [];
  const aside = new Set(unread.map(({ pin }) => pin.id));
  const chats =
    order === "recent"
      ? regular.sort(byRecent)
      : order === "unread-first"
        ? regular.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || byRecent(a, b))
        : regular;

  if (!layout) {
    return {
      waiting,
      unread,
      entries: chats.flatMap((chat): SidebarEntry<Chat>[] =>
        aside.has(chat.pin.id) ? [] : [{ kind: "chat", chat, sectionId: null }],
      ),
    };
  }

  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  const parents = sidebarFolderParents(layout);
  const groups = new Map<string, Chat[]>();
  for (const chat of chats) {
    const assignment = layout.agentAssignments[chat.pin.id];
    const id = assignment && names.has(assignment) ? assignment : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(id) ?? [];
    group.push(chat);
    groups.set(id, group);
  }
  // Server snapshots predating folder preorder can omit a section or the main group.
  const knownOrder = new Set(layout.order);
  const missing = [SIDEBAR_UNASSIGNED_SECTION_ID, ...names.keys()].filter(
    (id) => !knownOrder.has(id),
  );
  const sectionOrder = missing.length
    ? sidebarFolderTreeOrder([...missing, ...knownOrder], parents)
    : [...knownOrder];
  const entries = sectionOrder.flatMap((id): SidebarEntry<Chat>[] => {
    const ancestorIds = sidebarFolderAncestors(parents, id);
    if (ancestorIds.some((parent) => collapsed.has(parent))) return [];
    const group = (groups.get(id) ?? []).filter(({ pin }) => !aside.has(pin.id));
    const name = names.has(id)
      ? sidebarFolderPath(layout, parents, id).join(" / ")
      : id === SIDEBAR_UNASSIGNED_SECTION_ID && group.length > 0
        ? "Agents"
        : null;
    if (name === null) return [];
    const isCollapsed = collapsed.has(id);
    return [
      {
        kind: "section",
        section: {
          id,
          name,
          parentId: parents.get(id) ?? null,
          ancestorIds,
          collapsed: isCollapsed,
        },
      },
      ...(isCollapsed
        ? []
        : group.map((chat): SidebarEntry<Chat> => ({ kind: "chat", chat, sectionId: id }))),
    ];
  });
  return { waiting, unread, entries };
}
