import { expect, it } from "vite-plus/test";
import { directMessages, orderedPeople, readDirectDraft, validDirectPage } from "./directModel";
import type { OpenbotDirectPage } from "@t3tools/contracts";
const message = {
  id: "m2",
  threadId: "thread",
  senderMemberId: "self",
  recipientMemberId: "other",
  text: "latest",
  createdAt: "now",
  sequence: 2,
};
const page: OpenbotDirectPage = {
  threadId: "thread",
  otherMemberId: "other",
  revision: 2,
  messages: [message],
  pageInfo: { hasOlder: true, olderCursor: "cursor" },
};
it("merges direct history without crossing members or replacing current messages with stale overlap", () => {
  const older = {
    ...page,
    messages: [
      { ...message, id: "m1", sequence: 1 },
      { ...message, text: "stale" },
    ],
  };
  expect(
    directMessages(page, [
      older,
      { ...page, threadId: "foreign", messages: [{ ...message, id: "foreign" }] },
    ]).map((m) => [m.id, m.text]),
  ).toEqual([
    ["m1", "latest"],
    ["m2", "latest"],
  ]);
  expect(validDirectPage(page, "other", "self")).toBe(true);
  expect(validDirectPage(page, "foreign", "self")).toBe(false);
  expect(
    validDirectPage(
      { ...page, messages: [{ ...message, recipientMemberId: "foreign" }] },
      "other",
      "self",
    ),
  ).toBe(false);
});
it("uses source People ordering while excluding self and disabled members", () => {
  const base = { username: "person", name: null, email: null, disabled: false, online: false };
  const members = [
    { ...base, id: "self" },
    { ...base, id: "disabled", disabled: true },
    { ...base, id: "offline" },
    { ...base, id: "online", online: true },
    { ...base, id: "recent" },
  ];
  const threads = [
    {
      threadId: "thread",
      otherMemberId: "recent",
      unreadCount: 1,
      lastMessage: message,
      updatedAt: "2026-11-10",
    },
  ];
  expect(orderedPeople(members, "self", threads, []).map((m) => m.id)).toEqual([
    "recent",
    "online",
    "offline",
  ]);
  expect(orderedPeople(members, "self", threads, ["offline"]).map((m) => m.id)).toEqual([
    "offline",
    "recent",
    "online",
  ]);
});
it("retains the original unconfirmed send identity and body after draft reload", () => {
  const value = { text: "Hello", attempt: { id: "original-attempt", text: "Hello" } };
  const storage = {
    getItem: (key: string) => (key === "original-scope" ? JSON.stringify(value) : null),
  };
  expect(readDirectDraft(storage, "original-scope")).toEqual(value);
  expect(readDirectDraft(storage, "different-scope")).toEqual({ text: "", attempt: null });
  expect(
    readDirectDraft(
      { getItem: () => JSON.stringify({ text: "Hello", attempt: { text: "Hello" } }) },
      "original-scope",
    ),
  ).toEqual({ text: "", attempt: null });
});
