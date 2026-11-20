import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { OpenbotAgent, OpenbotChannelSummary } from "@t3tools/contracts";
import { settingRequest, settingIsRead } from "@t3tools/client-runtime/openbot/settings";
import {
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
} from "./openbotSidebarFolders";
import type { SidebarDragSource, SidebarDropTarget } from "./openbotSidebarDrag";

export const SIDEBAR_PEOPLE_SECTION_ID = "people";
export const SIDEBAR_UNASSIGNED_SECTION_ID = "unassigned";
export const SIDEBAR_FOLDER_LEVELS = 3;
const Layout = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sections: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      parentId: Schema.optional(Schema.String),
    }),
  ),
  order: Schema.Array(Schema.String),
  agentAssignments: Schema.Record(Schema.String, Schema.String),
  agentOrder: Schema.Array(Schema.String),
});
export type SidebarLayout = typeof Layout.Type;
const decodeLayout = Schema.decodeUnknownResult(Layout);
export const EMPTY_SIDEBAR: SidebarLayout = {
  revision: 0,
  sections: [],
  order: ["people", "unassigned"],
  agentAssignments: {},
  agentOrder: [],
};

// OpenBot rejects incomplete section orders so assigned conversations never silently disappear.
export function parseSidebarLayout(value: unknown): SidebarLayout | null {
  const decoded = decodeLayout(value);
  if (Result.isFailure(decoded)) return null;
  const layout = decoded.success;
  const ids = layout.sections.map((section) => section.id);
  const expected = new Set(["people", "unassigned", ...ids]);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => id === "people" || id === "unassigned") ||
    layout.order.length !== expected.size ||
    new Set(layout.order).size !== layout.order.length ||
    layout.order.some((id) => !expected.has(id)) ||
    new Set(layout.agentOrder).size !== layout.agentOrder.length
  )
    return null;
  return layout;
}

export function newestSidebarLayout(
  read: SidebarLayout | null,
  saved: SidebarLayout | null,
): SidebarLayout | null {
  return saved && (!read || saved.revision > read.revision) ? saved : read;
}

export function sidebarOptionalRead(
  allowed: boolean,
  query: { data: unknown; error: string | null; isSuccess: boolean },
): unknown {
  return allowed && query.isSuccess && !query.error ? query.data : null;
}

// Optional settings authority can differ from the connection's advertised scopes.
export function projectSidebarLayout(
  core: { data: unknown; error: string | null },
  folders: { data: unknown; error: string | null; isSuccess: boolean },
  foldersAllowed: boolean,
  saved: SidebarLayout | null,
) {
  const baseline = parseSidebarLayout(core.data);
  const enhanced = parseSidebarLayout(sidebarOptionalRead(foldersAllowed, folders));
  return {
    layout: (enhanced ? newestSidebarLayout(enhanced, saved) : baseline) ?? EMPTY_SIDEBAR,
    foldersMutable: enhanced !== null && !core.error,
    error:
      core.error ??
      (core.data !== null && !baseline
        ? "The host sidebar layout is incomplete. All chats remain available below."
        : null),
  };
}

export type SidebarChat =
  | { kind: "agent"; id: string; agent: typeof OpenbotAgent.Type }
  | { kind: "channel"; id: string; channel: OpenbotChannelSummary };

export function orderedSidebarChats(
  layout: SidebarLayout,
  agents: readonly (typeof OpenbotAgent.Type)[],
  channels: readonly OpenbotChannelSummary[],
): SidebarChat[] {
  const chats: SidebarChat[] = [
    ...channels.map((channel): SidebarChat => ({ kind: "channel", id: channel.id, channel })),
    ...agents.map((agent): SidebarChat => ({ kind: "agent", id: agent.id, agent })),
  ];
  const rank = new Map(layout.agentOrder.map((id, index) => [id, index]));
  return chats.sort(
    (left, right) =>
      (rank.get(left.id) ?? layout.agentOrder.length) -
      (rank.get(right.id) ?? layout.agentOrder.length),
  );
}

export function sidebarSectionOf(layout: SidebarLayout, chatId: string): string {
  const sectionId = layout.agentAssignments[chatId];
  return sectionId &&
    layout.order.includes(sectionId) &&
    layout.sections.some((section) => section.id === sectionId)
    ? sectionId
    : "unassigned";
}

export function sidebarCanNest(
  layout: SidebarLayout,
  sectionId: string,
  parentId: string | null,
): boolean {
  if (sectionId === "people" || sectionId === "unassigned") return parentId === null;
  if (!layout.sections.some((section) => section.id === sectionId)) return false;
  if (parentId === null) return true;
  const parents = sidebarFolderParents(layout);
  return (
    parentId !== sectionId &&
    layout.sections.some((section) => section.id === parentId) &&
    !sidebarFolderAncestors(parents, parentId).includes(sectionId) &&
    sidebarFolderAncestors(parents, parentId).length +
      2 +
      sidebarFolderHeight(parents, sectionId) <=
      SIDEBAR_FOLDER_LEVELS
  );
}

export type SidebarAction =
  | { type: "create"; name: string; agentId?: string; parentId?: string }
  | { type: "rename"; sectionId: string; name: string }
  | { type: "delete"; sectionId: string }
  | { type: "move"; sectionId: string; direction: "up" | "down"; steps?: number }
  | { type: "move-agent"; agentId: string; sectionId: string | null; beforeAgentId: string | null }
  | { type: "nest"; sectionId: string; parentId: string | null; beforeSectionId: string | null };

export function sidebarActionRequest(action: SidebarAction) {
  const request = settingRequest("settings.sidebar-folders.actions", action);
  return request && !settingIsRead(request) ? request : null;
}

// The released wire field is agentId for both agents and channels; never replace it with a UI key.
export function sidebarDropAction(
  layout: SidebarLayout,
  chats: readonly SidebarChat[],
  source: SidebarDragSource,
  target: SidebarDropTarget | null,
): SidebarAction | null {
  if (!target) return null;
  if (source.kind === "chat") {
    if (!chats.some((chat) => chat.id === source.id)) return null;
    if (target.kind !== "chat" && target.kind !== "section") return null;
    const sectionId = target.kind === "chat" ? target.target.sectionId : target.sectionId;
    if (sectionId !== "unassigned" && !layout.sections.some((section) => section.id === sectionId))
      return null;
    let beforeAgentId: string | null = null;
    if (target.kind === "chat") {
      const ids = chats
        .filter((chat) => chat.id !== source.id && sidebarSectionOf(layout, chat.id) === sectionId)
        .map((chat) => chat.id);
      const index = ids.indexOf(target.target.chatId);
      if (index < 0) return null;
      beforeAgentId =
        target.target.placement === "before" ? target.target.chatId : (ids[index + 1] ?? null);
    }
    return {
      type: "move-agent",
      agentId: source.id,
      sectionId: sectionId === "unassigned" ? null : sectionId,
      beforeAgentId,
    };
  }
  if (source.kind !== "section") return null;
  const parents = sidebarFolderParents(layout);
  if (target.kind === "section-into")
    return sidebarCanNest(layout, source.id, target.sectionId)
      ? { type: "nest", sectionId: source.id, parentId: target.sectionId, beforeSectionId: null }
      : null;
  if (target.kind !== "section-order" || source.id === target.target.sectionId) return null;
  const parentId = parents.get(target.target.sectionId) ?? null;
  if (!sidebarCanNest(layout, source.id, parentId)) return null;
  const siblings = layout.order.filter(
    (id) => id !== source.id && (parents.get(id) ?? null) === parentId,
  );
  const index = siblings.indexOf(target.target.sectionId);
  if (index < 0) return null;
  return {
    type: "nest",
    sectionId: source.id,
    parentId,
    beforeSectionId:
      target.target.placement === "before"
        ? target.target.sectionId
        : (siblings[index + 1] ?? null),
  };
}

const Pins = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ kind: Schema.Literals(["agent", "channel"]), id: Schema.String }),
  ),
});
const Hidden = Schema.Struct({
  agents: Schema.Array(Schema.Struct({ agentId: Schema.String, hiddenAt: Schema.String })),
});
const decodePins = Schema.decodeUnknownResult(Pins);
const decodeHidden = Schema.decodeUnknownResult(Hidden);
export function sidebarPins(value: unknown) {
  const result = decodePins(value);
  return Result.isSuccess(result) ? result.success.items : [];
}
export type SidebarPin = (typeof Pins.Type)["items"][number];

export function sidebarPinRequest(items: readonly SidebarPin[], item: SidebarPin, pinned: boolean) {
  const key = sidebarChatKey(item);
  const next = items.filter((candidate) => sidebarChatKey(candidate) !== key);
  if (pinned) next.push(item);
  const request = settingRequest("settings.sidebar-pins.set", { items: next });
  return request && !settingIsRead(request) ? request : null;
}

export function sidebarPinReorderRequest(
  items: readonly SidebarPin[],
  key: string,
  direction: -1 | 1,
) {
  const index = items.findIndex((item) => sidebarChatKey(item) === key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return null;
  const next = [...items];
  const item = next.splice(index, 1)[0];
  if (!item) return null;
  next.splice(nextIndex, 0, item);
  const request = settingRequest("settings.sidebar-pins.set", { items: next });
  return request && !settingIsRead(request) ? request : null;
}

export function sidebarHideRequest(agentId: string, hidden: boolean) {
  const request = settingRequest("settings.agent-hidden.set", { agentId, hidden });
  return request && !settingIsRead(request) ? request : null;
}
export function sidebarHidden(value: unknown) {
  const result = decodeHidden(value);
  return new Map(
    Result.isSuccess(result)
      ? result.success.agents.map((agent) => [agent.agentId, agent.hiddenAt])
      : [],
  );
}

export function sidebarChatName(chat: SidebarChat) {
  return chat.kind === "agent" ? chat.agent.name : chat.channel.name;
}
export function sidebarChatKey(chat: Pick<SidebarChat, "id" | "kind">) {
  return `${chat.kind}:${chat.id}`;
}
