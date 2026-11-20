import { expect, it } from "vite-plus/test";
import type { OpenbotDraftFile } from "@t3tools/contracts";
import {
  createBotShareTransfer,
  botShareRecovery,
  type BotShareDestination,
  type BotShareTransfer,
  type BotSharePorts,
} from "./incomingShare.ts";
const destination: BotShareDestination = {
  environmentId: "e",
  principalId: "p",
  hostId: "h",
  agentId: "a",
  threadId: "thread",
  target: { kind: "main" },
};
function fixture() {
  let state: BotShareTransfer | null = null;
  let current: BotShareDestination | null = destination;
  let consumed = false,
    sends = 0,
    uploads = 0;
  let records: OpenbotDraftFile[] = [];
  const ports: BotSharePorts = {
    read: async () => ({
      id: "share",
      text: "hello",
      sourceIds: ["copy-one", "copy-two"],
      transfer: state,
    }),
    save: async (expected, next) => {
      expect(state).toEqual(expected);
      state = next;
    },
    current: () => current,
    prepareUpload: async (sourceId) => ({
      operationId: sourceId,
      hostId: "h",
      agentId: "a",
      threadId: "thread",
      taskId: null,
      name: "same.txt",
      size: 3,
      mimeType: "text/plain",
      sha256: "a".repeat(64),
    }),
    recoverUpload: async () => ({ state: "ready", draft: records.at(-1)! }),
    upload: async () => {
      uploads++;
      const draft: OpenbotDraftFile = {
        hostId: "h",
        agentId: "a",
        attachment: {
          id: `draft${uploads}`,
          name: "same.txt",
          size: 3,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "text",
        },
        sha256: "a".repeat(64),
        state: "ready",
        sendText: null,
        messageId: null,
        conversationMessageId: null,
        committedAttachments: null,
        target: null,
        taskId: null,
      };
      records.push(draft);
      return draft;
    },
    list: async () => records,
    send: async (input) => {
      sends++;
      records = records.map((d) => ({
        ...d,
        state: "sent",
        sendText: input.text,
        expectedThreadId: input.expectedThreadId,
        target: input.target!,
        messageId: "receipt",
        batchAttachmentIds: input.attachmentIds,
      }));
      throw new Error("lost response");
    },
    discard: async (id) => {
      records = records.filter((d) => d.attachment.id !== id);
    },
    consume: async (expected) => {
      expect(state).toEqual(expected);
      consumed = true;
    },
  };
  return {
    ports,
    create: () => createBotShareTransfer(destination, ports),
    state: () => state,
    consumed: () => consumed,
    sends: () => sends,
    uploads: () => uploads,
    switchTo: (d: BotShareDestination) => {
      current = d;
    },
    corrupt: () => {
      records = records.map((d) => ({ ...d, sha256: "b".repeat(64) }));
    },
  };
}
it("defers consume, keeps all exact copies and reconciles lost batch send after restart without duplicate delivery", async () => {
  const f = fixture();
  const c = f.create();
  await c.stage();
  expect(f.consumed()).toBe(false);
  expect(f.uploads()).toBe(2);
  expect(f.sends()).toBe(0);
  await expect(c.send()).rejects.toThrow("lost response");
  await expect(c.send()).rejects.toThrow("Reconcile");
  await expect(c.cancel()).rejects.toThrow("Reconcile");
  await f.create().reconcile();
  expect(f.consumed()).toBe(true);
  expect(f.sends()).toBe(1);
});
it("refuses switched principal and wrong receipt identity while retaining the drafts", async () => {
  const f = fixture();
  const c = f.create();
  await c.stage();
  f.switchTo({ ...destination, principalId: "other" });
  await expect(c.send()).rejects.toThrow("destination changed");
  expect(f.sends()).toBe(0);
  f.switchTo(destination);
  await expect(c.send()).rejects.toThrow();
  f.corrupt();
  await expect(f.create().reconcile()).rejects.toThrow("not confirmed");
  expect(f.consumed()).toBe(false);
});
it("cancels ready drafts and permits explicit restaging; closes unknown upload and stops detached work", async () => {
  const f = fixture();
  await f.create().stage();
  await f.create().cancel();
  expect(f.state()).toBeNull();
  await f.create().stage();
  expect(f.uploads()).toBe(4);
  const g = fixture();
  g.ports.upload = async () => {
    throw new Error("lost upload");
  };
  await expect(g.create().stage()).rejects.toThrow("lost upload");
  await expect(g.create().stage()).rejects.toThrow("unknown");
  await expect(g.create().cancel()).rejects.toThrow("unknown");
  expect(g.consumed()).toBe(false);
  const stopped = f.create();
  stopped.stop();
  await expect(stopped.send()).rejects.toThrow("destination changed");
});

it("serializes duplicate gestures and persists a late upload receipt without sending after target switch", async () => {
  const f = fixture();
  const upload = f.ports.upload;
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ports.upload = async (id) => {
    started();
    await waiting;
    return upload(id);
  };
  const c = f.create();
  const stage = c.stage();
  await entered;
  await expect(c.stage()).rejects.toThrow("already running");
  f.switchTo({
    ...destination,
    threadId: "other-thread",
    target: { kind: "task", taskId: "other-task" },
  });
  release();
  await expect(stage).rejects.toThrow("destination changed");
  expect(f.state()?.drafts).toHaveLength(1);
  expect(f.state()?.pendingSourceId).toBeNull();
  expect(f.uploads()).toBe(1);
  expect(f.sends()).toBe(0);
  expect(f.consumed()).toBe(false);
  f.switchTo(destination);
  await f.create().stage();
  expect(f.uploads()).toBe(2);
});

it("refuses persisted receipts under a new authenticated app session even on the same upstream host", async () => {
  const f = fixture();
  await f.create().stage();
  const other = { ...destination, principalId: "new-app-session" };
  f.switchTo(other);
  await expect(createBotShareTransfer(other, f.ports).send()).rejects.toThrow(
    "original signed-in session",
  );
  expect(f.sends()).toBe(0);
  expect(f.consumed()).toBe(false);
});

it("recovers exact original upload after lost response and reload without uploading or sending again", async () => {
  const f = fixture();
  const upload = f.ports.upload;
  f.ports.upload = async (sourceId, identity) => {
    expect(f.state()?.pendingUpload).toEqual(identity);
    await upload(sourceId, identity);
    throw new Error("accepted response lost");
  };
  await expect(f.create().stage()).rejects.toThrow("accepted response lost");
  expect(f.state()?.pendingUpload?.operationId).toBe("copy-one");
  await f.create().reconcile();
  expect(f.state()?.drafts).toHaveLength(1);
  expect(f.state()?.pendingSourceId).toBeNull();
  expect(f.uploads()).toBe(1);
  expect(f.sends()).toBe(0);
  expect(f.consumed()).toBe(false);
});
it("keeps original source and unknown phase when no committed upload is established", async () => {
  const f = fixture();
  f.ports.upload = async () => {
    throw new Error("precommit loss");
  };
  f.ports.recoverUpload = async () => ({ state: "absent", draft: null });
  await expect(f.create().stage()).rejects.toThrow();
  await expect(f.create().reconcile()).rejects.toThrow("No committed upload established");
  expect(f.state()?.pendingSourceId).toBe("copy-one");
  expect(f.consumed()).toBe(false);
  expect(f.sends()).toBe(0);
});

it("identifies a retained share belonging to an old session without enabling replay", async () => {
  const f = fixture();
  await f.create().stage();
  const state = f.state()!;
  const replacement = { ...destination, principalId: "replacement" };
  const recovery = botShareRecovery(state, replacement);
  expect(recovery.reason).toBe("session-mismatch");
  expect(recovery.canReconcile).toBe(false);
  await expect(
    createBotShareTransfer(replacement, { ...f.ports, current: () => replacement }).reconcile(),
  ).rejects.toThrow("original signed-in session");
  expect(f.state()).toEqual(state);
  expect(f.sends()).toBe(0);
});
it("keeps an exact cancelled upload tombstone visible and only permits confirmed cancellation", async () => {
  const f = fixture();
  f.ports.upload = async () => {
    throw new Error("lost response");
  };
  f.ports.recoverUpload = async () => ({ state: "released", draft: null });
  f.ports.cancelUpload = async () => ({ state: "released", draft: null });
  await expect(f.create().stage()).rejects.toThrow("lost response");
  const identity = f.state()!.pendingUpload;
  await expect(f.create().reconcile()).rejects.toThrow("cancelled");
  expect(f.state()!.pendingUpload).toEqual(identity);
  expect(botShareRecovery(f.state(), destination).reason).toBe("cancelled");
  await expect(f.create().stage()).rejects.toThrow("cancelled");
  expect(f.uploads()).toBe(0);
  await f.create().cancel();
  expect(f.state()).toBeNull();
  expect(f.consumed()).toBe(false);
  expect(f.sends()).toBe(0);
});
