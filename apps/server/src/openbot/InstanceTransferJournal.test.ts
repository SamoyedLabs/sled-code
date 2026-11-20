// @effect-diagnostics nodeBuiltinImport:off -- Private temporary transfer journals.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "@effect/vitest";
import { InstanceTransferJournal } from "./InstanceTransferJournal.ts";
import { NewTaskStartJournal } from "./NewTaskStartJournal.ts";
const preview = {
  token: "upstream-only-token",
  appVersion: "0.60.0",
  exportedAt: null,
  agents: [
    {
      key: "one",
      name: "Bot",
      title: "",
      description: "",
      nameExists: false,
      skillCount: 1,
      routineCount: 2,
      memoryCount: 3,
      fileCount: 0,
      fileBytes: 0,
    },
  ],
  hasSettings: true,
  warnings: [],
};
const result = {
  agents: [{ agentId: "created", name: "Bot" }],
  skipped: [],
  signIn: [],
  warnings: [],
};
it("binds transfer tokens to the original session/host, retains exact apply results after reopen and refuses changed selections", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "transfer-journal-"));
  try {
    const store = new InstanceTransferJournal(root),
      stage = vi.fn(async () => preview),
      apply = vi.fn(async (token: string) => {
        expect(token).toBe(preview.token);
        return result;
      });
    const staged = await store.stage("session", "host", "original", "bytes-sha", stage);
    expect(staged.preview?.token).toBe("original");
    expect(JSON.stringify(staged)).not.toContain("upstream-only");
    expect(await store.recover("other", "host", "original")).toBeNull();
    expect(await store.recover("session", "other", "original")).toBeNull();
    expect(await new InstanceTransferJournal(root).pending("session", "host")).toEqual({
      requestId: "original",
      receipt: staged,
    });
    expect(await store.pending("other", "host")).toBeNull();
    expect(await store.pending("session", "other")).toBeNull();
    await store.stage("session", "host", "original", "bytes-sha", stage);
    expect(stage).toHaveBeenCalledOnce();
    await expect(
      store.stage("session", "host", "original", "changed-sha", stage),
    ).rejects.toThrow();
    const selection = { keys: ["one"], includeSettings: true, timezone: "UTC" };
    await store.apply("session", "host", "original", selection, apply);
    const reopened = new InstanceTransferJournal(root);
    expect(await reopened.pending("session", "host")).toBeNull();
    expect((await reopened.apply("session", "host", "original", selection, apply)).result).toEqual(
      result,
    );
    expect(apply).toHaveBeenCalledOnce();
    await expect(
      reopened.apply(
        "session",
        "host",
        "original",
        { ...selection, includeSettings: false },
        apply,
      ),
    ).rejects.toThrow();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("holds an interrupted apply without replaying mutation after restart", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "transfer-interrupted-"));
  try {
    const store = new InstanceTransferJournal(root);
    await store.stage("s", "h", "id", "sha", async () => preview);
    const apply = vi.fn(async () => {
      throw Error("reply lost");
    });
    const selection = { keys: ["one"], includeSettings: false, timezone: "UTC" };
    await expect(store.apply("s", "h", "id", selection, apply)).rejects.toThrow("reply lost");
    const reopened = new InstanceTransferJournal(root);
    expect(await reopened.pending("s", "h")).toMatchObject({
      requestId: "id",
      receipt: { state: "uncertain" },
    });
    expect((await reopened.recover("s", "h", "id"))?.state).toBe("uncertain");
    expect((await reopened.apply("s", "h", "id", selection, apply)).state).toBe("uncertain");
    expect(apply).toHaveBeenCalledOnce();
    await expect(reopened.discard("s", "h", "id", async () => null)).rejects.toThrow();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("retains exact stage replay after archive release and only releases finalized uploads", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "transfer-release-"));
  try {
    const store = new InstanceTransferJournal(root);
    await store.stage("s", "h", "original", "sha", async () => preview, "upload-one");
    expect(await store.finalizedUpload("s", "h", "original")).toBeNull();
    await store.apply(
      "s",
      "h",
      "original",
      { keys: ["one"], includeSettings: false, timezone: "UTC" },
      async () => result,
    );
    const reopened = new InstanceTransferJournal(root);
    expect(await reopened.finalizedUpload("s", "h", "original")).toEqual({
      uploadId: "upload-one",
      principal: "s",
    });
    expect(await reopened.finalizedUpload("other", "h", "original")).toBeNull();
    expect(await reopened.finalizedUpload("s", "other", "original")).toBeNull();
    expect((await reopened.stageReceipt("s", "h", "original", "upload-one"))?.state).toBe(
      "complete",
    );
    await expect(reopened.stageReceipt("s", "h", "original", "different-upload")).rejects.toThrow();
    await reopened.stage("s", "h", "interrupted", "sha", async () => preview, "upload-two");
    await expect(
      reopened.apply(
        "s",
        "h",
        "interrupted",
        { keys: ["one"], includeSettings: false, timezone: "UTC" },
        async () => {
          throw Error("lost reply");
        },
      ),
    ).rejects.toThrow();
    expect(await reopened.finalizedUpload("s", "h", "interrupted")).toBeNull();
    expect((await reopened.stageReceipt("s", "h", "interrupted", "upload-two"))?.state).toBe(
      "uncertain",
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("recovers only an authorized desktop predecessor without changing its original receipt or replaying work", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "transfer-successor-"));
  try {
    const store = new InstanceTransferJournal(root);
    const stage = vi.fn(async () => preview);
    const staged = await store.stage(
      "original-session",
      "host",
      "original-request",
      "sha",
      stage,
      "upload",
    );
    const original = (await NodeFSP.readdir(root)).find((name) => !name.startsWith("active-"))!;
    const before = await NodeFSP.readFile(NodePath.join(root, original), "utf8");
    const allow = async (owner: string) => owner === "original-session";
    const refuse = async () => false;
    const reopened = new InstanceTransferJournal(root);
    expect(await reopened.pending("successor", "host", refuse)).toBeNull();
    expect(await reopened.pending("successor", "other", allow)).toBeNull();
    expect(await reopened.pending("successor", "host", allow)).toEqual({
      requestId: "original-request",
      receipt: staged,
    });
    expect(await reopened.recover("successor", "host", "original-request", allow)).toEqual(staged);
    expect(await reopened.recover("successor", "host", "wrong-request", allow)).toBeNull();
    expect(await NodeFSP.readFile(NodePath.join(root, original), "utf8")).toBe(before);
    const discard = vi.fn(async () => null);
    await expect(
      reopened.discard("successor", "host", "original-request", discard, refuse),
    ).rejects.toThrow();
    expect(
      (await reopened.discard("successor", "host", "original-request", discard, allow)).state,
    ).toBe("discarded");
    await reopened.discard("successor", "host", "original-request", discard, allow);
    expect(discard).toHaveBeenCalledExactlyOnceWith(preview.token);
    expect(stage).toHaveBeenCalledOnce();
    expect(await reopened.finalizedUpload("successor", "host", "original-request", allow)).toEqual({
      uploadId: "upload",
      principal: "original-session",
    });
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("recovers a completed text task start after response loss and never starts a second task after an uncertain dispatch", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "new-task-journal-"));
  try {
    const input = { hostId: "h", agentId: "a", clientMessageId: "original", text: "First message" },
      start = vi.fn(async () => ({ id: "task-one", agentId: "a" }));
    await new NewTaskStartJournal(root).run("s", input, start);
    expect(await new NewTaskStartJournal(root).run("s", input, start)).toEqual({
      id: "task-one",
      agentId: "a",
    });
    expect(start).toHaveBeenCalledOnce();
    await expect(
      new NewTaskStartJournal(root).run("s", { ...input, text: "Changed" }, start),
    ).rejects.toThrow();
    const uncertain = vi.fn(async () => {
      throw Error("connection lost");
    });
    const next = { ...input, clientMessageId: "uncertain" };
    await expect(new NewTaskStartJournal(root).run("s", next, uncertain)).rejects.toThrow();
    await expect(new NewTaskStartJournal(root).run("s", next, uncertain)).rejects.toThrow(
      "uncertain",
    );
    expect(uncertain).toHaveBeenCalledOnce();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
