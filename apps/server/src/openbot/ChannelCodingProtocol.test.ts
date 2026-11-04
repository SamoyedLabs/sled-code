import * as Schema from "effect/Schema";
import { OpenbotChannelCodingReceipt } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import {
  channelCoding,
  codingLifetime,
  decodeCodingReceipt,
  type CodingBinding,
  type CodingSnapshot,
  type CodingReceipt,
} from "./upstream/channel-coding/extension.ts";

const decodeReceipt = Schema.decodeSync(OpenbotChannelCodingReceipt);

const binding: CodingBinding = {
  channelId: "channel",
  taskId: "task",
  taskRevision: 2,
  assignmentId: "assignment",
  agentId: "agent",
  turnId: "turn",
  requestMessageId: "request",
  requesterId: "original-person",
  operationId: "coding",
};
const actor = {
  agentId: binding.agentId,
  turnId: binding.turnId,
  requesterId: binding.requesterId,
};
function fixture() {
  let durable = JSON.stringify({ receipt: null, result: null });
  let commits = 0;
  const snapshot: CodingSnapshot = {
    channelId: "channel",
    archived: false,
    member: true,
    task: {
      id: "task",
      revision: 2,
      state: "running",
      ownerAgentId: "agent",
      requestMessageId: "request",
    },
    assignment: {
      id: "assignment",
      taskId: "task",
      taskRevision: 2,
      agentId: "agent",
      turnId: "turn",
      state: "running",
      requestMessageId: "request",
    },
    requesterId: "original-person",
    receipt: null,
    result: null,
  };
  let now = 1_000;
  const reopen = () => ({
    now: () => now,
    read: () => {
      const persisted = JSON.parse(durable);
      return {
        ...snapshot,
        ...persisted,
        receipt: persisted.receipt === null ? null : decodeCodingReceipt(persisted.receipt),
      };
    },
    commit: (receipt: CodingReceipt, writeResult: boolean) => {
      commits++;
      durable = JSON.stringify({
        receipt,
        result: writeResult ? receipt.result : JSON.parse(durable).result,
      });
    },
  });
  return {
    snapshot,
    reopen,
    count: () => commits,
    advance: (time: number) => {
      now = time;
    },
  };
}
it("persists exact assignment receipts and reconciles uncertain result submission after reopen", () => {
  const f = fixture();
  expect(channelCoding(f.reopen(), actor, binding, "bind")?.result).toBeNull();
  channelCoding(f.reopen(), actor, binding, "bind");
  expect(f.count()).toBe(1);
  channelCoding(f.reopen(), actor, binding, "submit", "Exact result\nwith evidence");
  channelCoding(f.reopen(), actor, binding, "submit", "Exact result\nwith evidence");
  expect(f.count()).toBe(2);
  expect(() => channelCoding(f.reopen(), actor, binding, "submit", "Changed result")).toThrow(
    "conflict",
  );
  f.snapshot.task.state = "completed";
  f.snapshot.assignment.state = "completed";
  expect(channelCoding(f.reopen(), actor, binding, "receipt")?.result?.text).toBe(
    "Exact result\nwith evidence",
  );
  expect(() =>
    channelCoding(f.reopen(), actor, binding, "submit", "Exact result\nwith evidence"),
  ).toThrow("stale");
});
it("rejects stale, cancelled, reassigned, archived and removed-member work before committing", () => {
  for (const alter of [
    (s: CodingSnapshot) => {
      s.task.revision++;
    },
    (s: CodingSnapshot) => {
      s.task.state = "cancelled";
    },
    (s: CodingSnapshot) => {
      s.task.ownerAgentId = "other";
    },
    (s: CodingSnapshot) => {
      s.assignment.turnId = "new-turn";
    },
    (s: CodingSnapshot) => {
      s.archived = true;
    },
    (s: CodingSnapshot) => {
      s.member = false;
    },
    (s: CodingSnapshot) => {
      s.requesterId = "another-person";
    },
  ]) {
    const f = fixture();
    alter(f.snapshot);
    expect(() => channelCoding(f.reopen(), actor, binding, "bind")).toThrow();
    expect(f.count()).toBe(0);
  }
});
it("binds operation and original requester and never overwrites a provider result", () => {
  const f = fixture();
  channelCoding(f.reopen(), actor, binding, "bind");
  expect(() =>
    channelCoding(f.reopen(), actor, { ...binding, operationId: "other" }, "bind"),
  ).toThrow("conflict");
  expect(() =>
    channelCoding(f.reopen(), { ...actor, requesterId: "other" }, binding, "submit", "result"),
  ).toThrow("authority");
  const port = f.reopen();
  expect(() =>
    channelCoding(
      {
        ...port,
        read: () => ({
          ...port.read(),
          result: { messageId: "existing", text: "provider result" },
        }),
      },
      actor,
      binding,
      "submit",
      "replacement",
    ),
  ).toThrow("already has a result");
  expect(f.count()).toBe(1);
});

it("preserves the exact submitted text across the typed contract", () => {
  const text = "  exact result\n";
  for (const assignmentId of ["assignment", "a".repeat(512)]) {
    const messageId = `channel-result-${assignmentId}-revision-2`;
    const receipt = decodeReceipt({
      binding: { ...binding, assignmentId },
      result: { messageId, text },
    });
    expect(receipt.result?.text).toBe(text);
    expect(receipt.result?.messageId).toBe(messageId);
  }
});

it("reserves a bounded durable assignment lifetime without extending it on bind replay", () => {
  const f = fixture();
  const receipt = channelCoding(f.reopen(), actor, binding, "bind");
  expect(receipt).toHaveProperty("lease");
  expect(channelCoding(f.reopen(), actor, binding, "bind")).toEqual(receipt);
  expect(f.count()).toBe(1);
});

it("holds successful provider completion across reopen, releases on result, and expires without renewal", () => {
  const f = fixture();
  const receipt = channelCoding(f.reopen(), actor, binding, "bind")!;
  expect(codingLifetime(f.reopen().read(), 1_001, "completed")).toBe("hold");
  const held = { ...receipt, lease: { ...receipt.lease!, providerCompleted: true } };
  f.reopen().commit(held, false);
  expect(f.reopen().read().receipt?.lease?.providerCompleted).toBe(true);
  expect(codingLifetime(f.reopen().read(), 1_002, "completed")).toBe("hold");
  expect(codingLifetime(f.reopen().read(), 1_002, "interrupted")).toBe("complete");
  expect(codingLifetime(f.reopen().read(), 1_002, "failed")).toBe("complete");
  const deadline = receipt.lease!.expiresAt;
  expect(codingLifetime(f.reopen().read(), deadline, "completed")).toBe("interrupt");
  f.advance(deadline);
  expect(() => channelCoding(f.reopen(), actor, binding, "submit", "late")).toThrow("expired");
  expect(() => channelCoding(f.reopen(), actor, binding, "bind")).toThrow("expired");
  expect(channelCoding(f.reopen(), actor, binding, "receipt")).toEqual(held);
  f.advance(deadline - 1);
  channelCoding(f.reopen(), actor, binding, "submit", "exact result");
  expect(codingLifetime(f.reopen().read(), deadline - 1, "completed")).toBe("complete");
});

it("does not hold stale identities or existing provider results, and rejects corrupt persisted leases", () => {
  const f = fixture();
  const receipt = channelCoding(f.reopen(), actor, binding, "bind")!;
  for (const alter of [
    (v: CodingSnapshot) => {
      v.task.revision++;
    },
    (v: CodingSnapshot) => {
      v.assignment.turnId = "new";
    },
    (v: CodingSnapshot) => {
      v.task.ownerAgentId = "new";
    },
    (v: CodingSnapshot) => {
      v.task.state = "cancelled";
    },
    (v: CodingSnapshot) => {
      v.archived = true;
    },
    (v: CodingSnapshot) => {
      v.result = { messageId: "provider", text: "provider" };
    },
    (v: CodingSnapshot) => {
      v.receipt = { ...receipt };
      delete v.receipt.lease;
    },
  ]) {
    const view = structuredClone(f.reopen().read());
    alter(view);
    expect(codingLifetime(view, 1_001, "completed")).toBe(
      view.result || !view.receipt?.lease ? "complete" : "interrupt",
    );
  }
  for (const lease of [
    null,
    {},
    { ...receipt.lease, expiresAt: 9e15 },
    { ...receipt.lease, providerCompleted: "true" },
  ]) {
    expect(() => decodeCodingReceipt({ ...receipt, lease })).toThrow("lease");
  }
});
