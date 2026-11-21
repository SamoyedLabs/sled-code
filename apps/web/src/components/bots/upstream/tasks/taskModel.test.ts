import { expect, it } from "vite-plus/test";
import { taskSections, taskSnapshot, type Task } from "./taskModel";
import {
  readNewThreadAttempt,
  retainNewThreadAttempt,
  clearNewThreadAttempt,
} from "./newThreadDraft";
const base: Task = {
  id: "task",
  agentId: "a",
  threadId: "thread",
  title: "Task",
  state: "idle",
  outcome: null,
  progress: null,
  error: null,
  updatedAt: "2026-11-09T00:00:00Z",
  closedAt: null,
};
it("groups tasks across agents by attention and retains archived counts while limiting the initial list", () => {
  const tasks: Task[] = [
    { ...base, id: "answer", outcome: "completed" },
    { ...base, id: "failure", agentId: "b", outcome: "failed" },
    { ...base, id: "running", state: "running" },
    { ...base, id: "queued", state: "queued" },
    ...Array.from({ length: 3 }, (_, index) => ({
      ...base,
      id: `closed-${index}`,
      state: "closed" as const,
      closedAt: `2026-11-0${index + 1}T00:00:00Z`,
    })),
  ];
  const sections = taskSections(tasks, false);
  expect(sections.map((section) => [section.id, section.tasks.map((task) => task.id)])).toEqual([
    ["needsYou", ["answer", "failure"]],
    ["working", ["running"]],
    ["waiting", ["queued"]],
    ["closed", ["closed-2", "closed-1"]],
  ]);
  const blocked = taskSections(tasks, false, (task) => task.id === "running");
  expect(
    blocked.find((section) => section.id === "needsYou")?.tasks.map((task) => task.id),
  ).toEqual(["answer", "failure", "running"]);
  expect(blocked.find((section) => section.id === "working")?.tasks).toEqual([]);
  expect(sections.at(-1)?.count).toBe(3);
  expect(taskSections(tasks, true).at(-1)?.tasks).toHaveLength(3);
});
it("rejects malformed task identities instead of making an unscoped task actionable", () => {
  expect(taskSnapshot({ tasks: [{ ...base, agentId: undefined }] })).toBeNull();
  expect(taskSnapshot({ tasks: [base] })?.[0]?.threadId).toBe("thread");
});
it("retains uncertain starts only within their environment, host and agent and clears only the accepted start", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const scope = JSON.stringify(["environment", "host", "agent"]);
  const other = JSON.stringify(["environment", "host", "other-agent"]);
  const attempt = { clientMessageId: "stable-first-send", text: "Draft to recover" };
  retainNewThreadAttempt(scope, attempt, storage);
  expect(readNewThreadAttempt(scope, storage)).toEqual(attempt);
  expect(readNewThreadAttempt(other, storage)).toBeNull();
  retainNewThreadAttempt(other, { ...attempt, clientMessageId: "other-start" }, storage);
  clearNewThreadAttempt(scope, storage);
  expect(readNewThreadAttempt(scope, storage)).toBeNull();
  expect(readNewThreadAttempt(other, storage)?.clientMessageId).toBe("other-start");
  expect(
    readNewThreadAttempt(scope, { ...storage, getItem: () => '{"text":"missing identity"}' }),
  ).toBeNull();
});

it("retains file-only first turns and exact ordered attachment identities across recovery", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const attempt = {
    principalId: "original-session",
    clientMessageId: "original-start",
    text: "",
    attachmentIds: ["first-original", "second-original"],
  };
  retainNewThreadAttempt("original-scope", attempt, storage);
  expect(readNewThreadAttempt("original-scope", storage)).toEqual(attempt);
  expect(readNewThreadAttempt("other-scope", storage)).toBeNull();
  retainNewThreadAttempt("empty", { ...attempt, attachmentIds: [] }, storage);
  expect(readNewThreadAttempt("empty", storage)).toBeNull();
});

it("refuses dispatch retention when browser storage fails or silently drops the record", () => {
  const attempt = { clientMessageId: "original", text: "Start" };
  expect(
    retainNewThreadAttempt("scope", attempt, {
      getItem: () => null,
      setItem: () => {
        throw Error("Storage full");
      },
      removeItem: () => {},
    }),
  ).toBe(false);
  expect(
    retainNewThreadAttempt("scope", attempt, {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }),
  ).toBe(false);
});
