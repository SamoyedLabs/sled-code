import { expect, it } from "vite-plus/test";
import { mobileSidebarRows } from "./upstream/openbot-mobile/workspace/sidebar-layout";

const makeChat = (id: string, day: number, unread = 0, needsInput = false) => ({
  pin: { id },
  updatedAt: `2026-11-${day}T00:00:00Z`,
  unread,
  needsInput,
});
const layout = {
  sections: [
    { id: "parent", name: "Project" },
    { id: "child", name: "Review", parentId: "parent" },
  ],
  order: ["unassigned", "parent", "child"],
  agentOrder: ["older", "newer", "old-unread", "new-unread"],
  agentAssignments: { "old-unread": "child", "new-unread": "child" },
};
const chats = [
  makeChat("newer", 19),
  makeChat("new-unread", 18, 1),
  makeChat("old-unread", 17, 2),
  makeChat("older", 16),
];
const chatIds = (rows: readonly ReturnType<typeof makeChat>[]) => rows.map(({ pin }) => pin.id);

it("follows desktop folder order and sorts the unread group independently", () => {
  const group = mobileSidebarRows(layout, chats, new Set(), "unread-group");
  expect(chatIds(group.unread)).toEqual(["new-unread", "old-unread"]);
  expect(group.entries.map((e) => (e.kind === "section" ? e.section.name : e.chat.pin.id))).toEqual(
    ["Agents", "older", "newer", "Project", "Project / Review"],
  );
  const manual = mobileSidebarRows(layout, chats, new Set(["parent"]), "manual");
  expect(
    manual.entries.map((e) => (e.kind === "section" ? e.section.name : e.chat.pin.id)),
  ).toEqual(["Agents", "older", "newer", "Project"]);
});

it("uses saved order for waiting chats and restores omitted groups on legacy hosts", () => {
  const legacy = { ...layout, order: ["parent"], agentOrder: ["older-waiting", "newer-waiting"] };
  const result = mobileSidebarRows(
    legacy,
    [...chats, makeChat("newer-waiting", 20, 1, true), makeChat("older-waiting", 16, 1, true)],
    new Set(),
    "unread-first",
  );
  expect(chatIds(result.waiting)).toEqual(["older-waiting", "newer-waiting"]);
  expect(
    result.entries.map((e) => (e.kind === "section" ? e.section.name : e.chat.pin.id)),
  ).toEqual([
    "Agents",
    "newer",
    "older",
    "Project",
    "Project / Review",
    "new-unread",
    "old-unread",
  ]);
});
