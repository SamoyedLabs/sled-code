import { expect, it } from "vite-plus/test";
import {
  createQueueAttachments,
  taskQueueAttachmentChoices,
  type QueueAttachmentState,
  type QueueAttachmentPorts,
} from "./queueAttachments.ts";
const scope = {
  principal: "p",
  environmentId: "e",
  hostId: "h",
  agentId: "a",
  threadId: "t",
  taskId: null,
  deliveryId: "d",
  editId: "edit",
};
const identity = {
  operationId: "u",
  hostId: "h",
  agentId: "a",
  threadId: "t",
  taskId: null,
  name: "a.txt",
  mimeType: "text/plain",
  size: 1,
  sha256: "a".repeat(64),
};
it("persists before upload/save and only looks up after response loss/reopen", async () => {
  let stored: QueueAttachmentState = {
    scope,
    edit: {
      ...scope,
      expectedRevision: "b".repeat(64),
      text: "edit",
      keepAttachmentIds: [],
      uploads: [],
    },
    phase: "ready",
    pendingUpload: null,
    receipt: null,
  };
  let saves = 0,
    lookups = 0;
  const receipt = {
    requestHash: "c".repeat(64),
    deliveryId: "d",
    editId: "edit",
    expectedRevision: "b".repeat(64),
    messageId: "m",
    attachments: [],
  };
  const ports: QueueAttachmentPorts = {
    current: () => scope,
    persist: async (s) => {
      stored = structuredClone(s);
    },
    upload: async () => {
      expect(stored.pendingUpload).toEqual(identity);
      return { draftId: "draft", sha256: identity.sha256 };
    },
    recoverUpload: async () => null,
    cancelUpload: async () => {},
    releaseEdit: async () => {},
    execute: async (_, lookup) => {
      if (lookup) {
        lookups++;
        return receipt;
      }
      saves++;
      expect(stored.phase).toBe("saving");
      throw new Error("lost");
    },
  };
  let c = createQueueAttachments(stored, ports);
  expect(await c.attach(identity)).toBe(true);
  expect(await c.save()).toBe(false);
  expect(await c.save()).toBe(false);
  c = createQueueAttachments(stored, ports);
  expect(await c.cancel()).toBe(false);
  expect(await c.reconcile()).toBe(true);
  expect(saves).toBe(1);
  expect(lookups).toBe(1);
  expect(stored.phase).toBe("saved");
});
it("retains uncertain original upload and refuses changed scope or wrong hash", async () => {
  const initial: QueueAttachmentState = {
    scope,
    edit: {
      ...scope,
      expectedRevision: "b".repeat(64),
      text: "original",
      keepAttachmentIds: [],
      uploads: [],
    },
    phase: "ready",
    pendingUpload: null,
    receipt: null,
  };
  let current = scope;
  const ports: QueueAttachmentPorts = {
    current: () => current,
    persist: async () => {},
    upload: async () => {
      throw new Error("lost");
    },
    recoverUpload: async () => ({ draftId: "wrong", sha256: "wrong" }),
    cancelUpload: async () => {},
    releaseEdit: async () => {},
    execute: async () => {
      throw new Error("must not send");
    },
  };
  const c = createQueueAttachments(initial, ports);
  expect(await c.attach(identity)).toBe(false);
  expect(c.state.pendingUpload).toEqual(identity);
  expect(await c.recoverUpload()).toBe(false);
  expect(await c.save()).toBe(false);
  current = { ...scope, principal: "other" };
  expect(await c.remove("u")).toBe(false);
  expect(await c.cancel()).toBe(false);
  expect(c.state.edit.text).toBe("original");
  current = scope;
  expect(await c.remove("u")).toBe(true);
  expect(c.state.pendingUpload).toBeNull();
});

it("rehydrates the original attempt from durable client storage without changing identity", async () => {
  const { queueAttachmentStorage } = await import("./queueAttachmentsStorage.ts");
  const { queueAttachmentInitial } = await import("./queueAttachments.ts");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const original = queueAttachmentInitial(scope, "b".repeat(64), "original", []);
  const journal = queueAttachmentStorage(scope, storage);
  await journal.persist({ ...original, phase: "saving", pendingUpload: identity });
  expect((await queueAttachmentStorage(scope, storage).read())?.pendingUpload).toEqual(identity);
  expect(await queueAttachmentStorage({ ...scope, principal: "other" }, storage).read()).toBeNull();
});

const retainedTaskList = {
  "agentId": "agent-c07fa9ec-4433-40ac-9c08-56cfd69a150c",
  "tasks": [
    {
      "id": "openbot-thread-b1157799-2940-45ca-bd9e-812e0b3d91ed",
      "agentId": "agent-c07fa9ec-4433-40ac-9c08-56cfd69a150c",
      "threadId": "openbot-thread-b1157799-2940-45ca-bd9e-812e0b3d91ed",
      "origin": "user",
      "title": "SLED_PRIVATE_QUEUE_HOLD task correction proof",
      "state": "running",
      "outcome": null,
      "hold": null,
      "activeTurnId": "b29c2f23-6d58-41c5-b61a-23286e3b967f",
      "progress": null,
      "error": null,
      "queuedMessages": [
        {
          "deliveryId": "0b91239e-604b-4d69-89e0-7a7b8300f73c",
          "text": "Owned queue attachment fixture 5d9691bc-6117-4a59-aded-13bb94493bd3",
          "createdAt": "2026-11-05T00:31:15.175Z"
        },
        {
          "deliveryId": "c071a389-e478-4c56-8d48-b27b5f11cbd5",
          "text": "Owned queue attachment fixture d400d10e-5300-4b49-9291-4b01339e2386",
          "createdAt": "2026-11-05T00:33:38.837Z"
        }
      ],
      "createdAt": "2026-11-05T00:31:15.131Z",
      "updatedAt": "2026-11-05T00:31:15.165Z",
      "closedAt": null
    }
  ],
  "limit": 2
};

it("offers task queue attachments from the released task list while validating the selected target", () => {
  const task = retainedTaskList.tasks[0]!;
  const target = { agentId: retainedTaskList.agentId, taskId: task.id, threadId: task.threadId };
  expect(taskQueueAttachmentChoices(retainedTaskList, target)).toEqual(
    task.queuedMessages.map(message => ({ id: message.deliveryId, text: message.text })),
  );
  expect(taskQueueAttachmentChoices({ ...retainedTaskList, tasks: [{ ...task, queuedMessages: [] }] }, target)).toEqual([]);
  expect(taskQueueAttachmentChoices({ ...retainedTaskList, tasks: [{ ...task, closedAt: "2026-11-05T01:00:00Z" }] }, target)).toEqual([]);
  for (const changed of [{ agentId: "other" }, { taskId: "other" }, { threadId: "other" }, { threadId: null }]) {
    expect(taskQueueAttachmentChoices(retainedTaskList, { ...target, ...changed })).toBeNull();
  }
  expect(taskQueueAttachmentChoices({ ...retainedTaskList, tasks: [{ ...task, agentId: "other" }] }, target)).toBeNull();
  expect(taskQueueAttachmentChoices({ ...retainedTaskList, tasks: [task, task] }, target)).toBeNull();
  expect(taskQueueAttachmentChoices({ ...retainedTaskList, tasks: [{ ...task, queuedMessages: [{ deliveryId: 42, text: "bad" }] }] }, target)).toBeNull();
  expect(taskQueueAttachmentChoices({ agentId: target.agentId, threadId: target.threadId, messages: [] }, target)).toBeNull();
});
