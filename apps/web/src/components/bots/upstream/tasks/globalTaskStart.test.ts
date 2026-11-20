import { expect, it } from "vite-plus/test";
import {
  readGlobalTaskAttempt,
  saveGlobalTaskAttempt,
  clearGlobalTaskAttempt,
  globalTaskCreated,
} from "./globalTaskStart";
it("retains the original principal, target, ordered files and queued/attempted phase across recovery; storage failure cannot confirm Undo", () => {
  const rows = new Map<string, string>();
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
  const attempt = {
    agentId: "agent",
    principalId: "session",
    requestId: "original",
    text: "",
    fileIds: ["second", "first"],
    phase: "queued" as const,
  };
  expect(saveGlobalTaskAttempt("host", attempt, storage)).toBe(true);
  expect(readGlobalTaskAttempt("host", storage)).toEqual(attempt);
  expect(readGlobalTaskAttempt("other-host", storage)).toBeNull();
  expect(saveGlobalTaskAttempt("host", { ...attempt, phase: "attempted" }, storage)).toBe(true);
  expect(readGlobalTaskAttempt("host", storage)?.phase).toBe("attempted");
  const unavailable = {
    ...storage,
    setItem: () => {
      throw Error("full");
    },
    removeItem: () => {
      throw Error("blocked");
    },
  };
  expect(saveGlobalTaskAttempt("host", { ...attempt, requestId: "replacement" }, unavailable)).toBe(
    false,
  );
  expect(clearGlobalTaskAttempt("host", unavailable)).toBe(false);
  expect(readGlobalTaskAttempt("host", storage)?.requestId).toBe("original");
  expect(clearGlobalTaskAttempt("host", storage)).toBe(true);
  expect(readGlobalTaskAttempt("host", storage)).toBeNull();
});
it("only accepts the created task identity for the original agent", () => {
  expect(globalTaskCreated({ id: "task", agentId: "original" }, "original")).toBe("task");
  expect(globalTaskCreated({ id: "task", agentId: "other" }, "original")).toBeNull();
  expect(globalTaskCreated(null, "original")).toBeNull();
});
