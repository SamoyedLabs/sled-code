import { describe, expect, it } from "vite-plus/test";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
import {
  sameWorkspaceUploadFile,
  sameWorkspaceUploadTarget,
  workspaceUploadRetry,
} from "./workspaceOriginalUpload";
const identity: OpenbotOriginalUploadIdentity = {
  hostId: "host",
  agentId: "bot",
  taskId: null,
  threadId: "original-thread",
  operationId: "original-operation",
  name: "file.txt",
  size: 5,
  mimeType: "text/plain",
  sha256: "a".repeat(64),
};
describe("composer original-upload recovery boundary", () => {
  it("reuses identical bytes only in the original host, agent, task and thread", () => {
    expect(sameWorkspaceUploadFile(identity, { ...identity })).toBe(true);
    for (const changed of [
      { hostId: "other-host" },
      { agentId: "other-agent" },
      { taskId: "task" },
      { threadId: "replacement-thread" },
    ]) {
      expect(sameWorkspaceUploadFile(identity, { ...identity, ...changed })).toBe(false);
      expect(sameWorkspaceUploadTarget(identity, { ...identity, ...changed })).toBe(false);
    }
  });
  it("does not recover a different original file from a coincident name or digest", () => {
    for (const changed of [
      { sha256: "b".repeat(64) },
      { name: "renamed.txt" },
      { size: 6 },
      { mimeType: "application/octet-stream" },
    ]) {
      expect(sameWorkspaceUploadFile(identity, { ...identity, ...changed })).toBe(false);
    }
  });
});

it("retains the exact operation on retry after a late ready receipt or failed cancellation", () => {
  const ready = { identity, phase: "ready" };
  expect(workspaceUploadRetry([ready], identity, identity.operationId)).toBe(ready);
  expect(workspaceUploadRetry([ready], identity, undefined)).toBeUndefined();
  expect(() =>
    workspaceUploadRetry([ready], { ...identity, threadId: "replacement" }, identity.operationId),
  ).toThrow();
  expect(() =>
    workspaceUploadRetry([{ identity, phase: "released" }], identity, identity.operationId),
  ).toThrow();
  expect(() => workspaceUploadRetry([], identity, identity.operationId)).toThrow();
});
