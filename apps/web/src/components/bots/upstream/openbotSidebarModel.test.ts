import { expect, it } from "vite-plus/test";
import type { OpenbotChannelSummary } from "@t3tools/contracts";
import {
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderTreeOrder,
} from "./openbotSidebarFolders";
import {
  EMPTY_SIDEBAR,
  newestSidebarLayout,
  orderedSidebarChats,
  parseSidebarLayout,
  sidebarActionRequest,
  projectSidebarLayout,
  sidebarOptionalRead,
  sidebarPinRequest,
  sidebarPinReorderRequest,
  sidebarHideRequest,
  sidebarCanNest,
  sidebarDropAction,
  sidebarSectionOf,
  type SidebarLayout,
} from "./openbotSidebarModel";

const layout: SidebarLayout = {
  revision: 4,
  sections: [
    { id: "work", name: "Work" },
    { id: "personal", name: "Personal" },
  ],
  order: ["people", "work", "unassigned", "personal"],
  agentAssignments: { a: "work", group: "work", b: "personal", orphan: "deleted-folder" },
  agentOrder: ["a", "group", "b"],
};
const agents = [
  { id: "a", name: "A", provider: "codex" },
  { id: "b", name: "B", provider: "codex" },
  { id: "orphan", name: "Orphan", provider: "codex" },
];
const channel: OpenbotChannelSummary = {
  id: "group",
  name: "Team",
  title: "",
  instructions: "",
  leadAgentId: null,
  members: [],
  archived: false,
  revision: 0,
  createdAt: "",
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: null,
};

it("keeps every agent and group once, preserves persisted order, and appends new groups before new agents", () => {
  const rows = orderedSidebarChats(
    layout,
    [...agents, { id: "new-agent", name: "New", provider: "codex" }],
    [channel, { ...channel, id: "new-group" }],
  );
  expect(rows.map((row) => row.id)).toEqual([
    "a",
    "group",
    "b",
    "new-group",
    "orphan",
    "new-agent",
  ]);
  expect(new Set(rows.map((row) => `${row.kind}:${row.id}`)).size).toBe(6);
  expect(sidebarSectionOf(layout, "orphan")).toBe("unassigned");
});

it("rejects incomplete/duplicate section order and retains a readable unassigned fallback", () => {
  expect(parseSidebarLayout(layout)).toEqual(layout);
  expect(parseSidebarLayout({ ...layout, order: ["people", "unassigned", "personal"] })).toBeNull();
  expect(
    parseSidebarLayout({ ...layout, order: ["people", "work", "work", "personal"] }),
  ).toBeNull();
  expect(parseSidebarLayout({ ...layout, agentOrder: ["a", "a"] })).toBeNull();
  expect(sidebarSectionOf({ ...layout, order: ["people", "unassigned"] }, "a")).toBe("unassigned");
  expect(orderedSidebarChats(EMPTY_SIDEBAR, agents, [channel]).map((row) => row.id)).toEqual([
    "group",
    "a",
    "b",
    "orphan",
  ]);
});

it("repairs folder cycles and flattens a deep branch to source's third level without losing folders", () => {
  const deep: SidebarLayout = {
    ...EMPTY_SIDEBAR,
    sections: [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
      { id: "c", name: "C", parentId: "a" },
      { id: "d", name: "D", parentId: "c" },
    ],
    order: ["people", "unassigned", "a", "b", "c", "d"],
  };
  const parents = sidebarFolderParents(deep);
  expect(parents.get("a")).toBe("b");
  expect(parents.has("b")).toBe(false);
  expect(parents.get("d")).toBe("a");
  for (const id of ["a", "b", "c", "d"])
    expect(sidebarFolderAncestors(parents, id).length).toBeLessThanOrEqual(2);
  expect(sidebarFolderTreeOrder(deep.order, parents)).toEqual([
    "people",
    "unassigned",
    "b",
    "a",
    "c",
    "d",
  ]);
  expect(sidebarCanNest(deep, "b", "c")).toBe(false);
  expect(sidebarCanNest(deep, "a", "d")).toBe(false);
  expect(sidebarCanNest(deep, "c", null)).toBe(true);
  expect(sidebarCanNest(deep, "people", null)).toBe(true);
  expect(sidebarCanNest(deep, "unassigned", null)).toBe(true);
  expect(sidebarCanNest(deep, "people", "a")).toBe(false);
  expect(sidebarCanNest(deep, "unassigned", "a")).toBe(false);
});

it("moves a group using its original channel id in the released agentId field", () => {
  const rows = orderedSidebarChats(layout, agents, [channel]);
  const action = sidebarDropAction(
    layout,
    rows,
    { kind: "chat", id: "group", origin: "section" },
    { kind: "chat", target: { chatId: "b", sectionId: "personal", placement: "before" } },
  );
  expect(action).toEqual({
    type: "move-agent",
    agentId: "group",
    sectionId: "personal",
    beforeAgentId: "b",
  });
  expect(action && sidebarActionRequest(action)).toEqual({
    operation: "settings.sidebar-folders.actions",
    parameters: { type: "move-agent", agentId: "group", sectionId: "personal", beforeAgentId: "b" },
  });
  expect(
    sidebarDropAction(
      layout,
      rows,
      { kind: "chat", id: "group", origin: "section" },
      { kind: "section", sectionId: "unassigned" },
    ),
  ).toEqual({ type: "move-agent", agentId: "group", sectionId: null, beforeAgentId: null });
});

it("resolves after-placement to the next sibling and rejects removed drop targets", () => {
  const rows = orderedSidebarChats(layout, agents, [channel]);
  expect(
    sidebarDropAction(
      layout,
      rows,
      { kind: "chat", id: "b", origin: "section" },
      { kind: "chat", target: { chatId: "a", sectionId: "work", placement: "after" } },
    ),
  ).toEqual({ type: "move-agent", agentId: "b", sectionId: "work", beforeAgentId: "group" });
  expect(
    sidebarDropAction(
      layout,
      rows,
      { kind: "chat", id: "a", origin: "section" },
      { kind: "section", sectionId: "deleted-folder" },
    ),
  ).toBeNull();
  expect(
    sidebarDropAction(
      layout,
      rows,
      { kind: "chat", id: "gone", origin: "section" },
      { kind: "section", sectionId: "work" },
    ),
  ).toBeNull();
  expect(
    sidebarDropAction(
      layout,
      rows,
      { kind: "section", id: "personal" },
      { kind: "section-order", target: { sectionId: "work", placement: "after" } },
    ),
  ).toEqual({ type: "nest", sectionId: "personal", parentId: null, beforeSectionId: "unassigned" });
});

it("keeps confirmed higher revisions while stale reads arrive", () => {
  const confirmed = { ...layout, revision: 9 };
  expect(newestSidebarLayout(layout, confirmed)).toBe(confirmed);
  expect(newestSidebarLayout(null, confirmed)).toBe(confirmed);
  const latest = { ...layout, revision: 10 };
  expect(newestSidebarLayout(latest, confirmed)).toBe(latest);
});

it("pins and unpins one kind without dropping the other kind with the same id or unseen pins", () => {
  const items = [
    { kind: "agent", id: "shared" },
    { kind: "channel", id: "shared" },
    { kind: "agent", id: "not-in-current-roster" },
  ] as const;
  expect(sidebarPinRequest(items, { kind: "agent", id: "shared" }, false)?.parameters).toEqual({
    items: [items[1], items[2]],
  });
  expect(sidebarPinRequest(items, { kind: "channel", id: "new-group" }, true)?.parameters).toEqual({
    items: [...items, { kind: "channel", id: "new-group" }],
  });
  expect(sidebarPinReorderRequest(items, "channel:shared", -1)?.parameters).toEqual({
    items: [items[1], items[0], items[2]],
  });
  expect(sidebarPinReorderRequest(items, "agent:shared", -1)).toBeNull();
});

it("uses the exact hidden restore and folder deletion contracts", () => {
  expect(sidebarHideRequest("original-agent", true)).toEqual({
    operation: "settings.agent-hidden.set",
    parameters: { agentId: "original-agent", hidden: true },
  });
  expect(sidebarHideRequest("original-agent", false)).toEqual({
    operation: "settings.agent-hidden.set",
    parameters: { agentId: "original-agent", hidden: false },
  });
  expect(sidebarActionRequest({ type: "delete", sectionId: "original-folder" })).toEqual({
    operation: "settings.sidebar-folders.actions",
    parameters: { type: "delete", sectionId: "original-folder" },
  });
});

it("retains the core sidebar when optional settings are refused despite advertised permission", () => {
  const saved = {
    ...layout,
    revision: 20,
    sections: [{ id: "private-folder", name: "Private" }],
    order: ["people", "unassigned", "private-folder"],
  };
  const refusal = {
    data: saved,
    error: "This connection requires settings:write.",
    isSuccess: false,
  };
  const projected = projectSidebarLayout({ data: layout, error: null }, refusal, true, saved);
  expect(projected.layout).toEqual(layout);
  expect(projected.error).toBeNull();
  expect(projected.foldersMutable).toBe(false);
  expect(sidebarOptionalRead(true, refusal)).toBeNull();
  expect(orderedSidebarChats(projected.layout, agents, [channel]).map((chat) => chat.id)).toEqual([
    "a",
    "group",
    "b",
    "orphan",
  ]);
});

it("enhances only successful allowed reads and reports core transport failures", () => {
  const enhanced = { ...layout, revision: 5 };
  const successful = { data: enhanced, error: null, isSuccess: true };
  expect(
    projectSidebarLayout({ data: layout, error: null }, successful, true, null).layout,
  ).toEqual(enhanced);
  expect(
    projectSidebarLayout({ data: layout, error: null }, successful, false, null).layout,
  ).toEqual(layout);
  expect(
    projectSidebarLayout(
      { data: layout, error: null },
      { ...successful, isSuccess: false },
      true,
      null,
    ).foldersMutable,
  ).toBe(false);
  const failed = projectSidebarLayout(
    { data: layout, error: "Host connection lost" },
    successful,
    true,
    null,
  );
  expect(failed.error).toBe("Host connection lost");
  expect(failed.foldersMutable).toBe(false);
  expect(sidebarOptionalRead(false, successful)).toBeNull();
});
