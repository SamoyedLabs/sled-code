import { expect, it } from "vite-plus/test";
import { createAgentImport } from "./agentImport.ts";
import { decodeImportReceipt } from "@t3tools/contracts/openbot-agent-import";
const receipt = {
  requestId: "req",
  token: "token",
  digest: "hash",
  preview: {
    token: "token",
    sourceApp: "fixture",
    exportedAt: null,
    agents: [
      {
        key: "a",
        name: "A",
        title: "",
        description: "",
        skillCount: 0,
        routineCount: 0,
        memoryCount: 0,
        fileCount: 0,
        fileBytes: 0,
        nameExists: false,
      },
    ],
    channels: [],
    warnings: [],
  },
  state: "staged",
  result: null,
  selection: null,
};
it("requires explicit choices and never replays an uncertain apply; refresh recovers its result", async () => {
  let calls = 0;
  let lost = false;
  const controller = createAgentImport("host", {
    upload: async () => ({ uploadId: "upload" }),
    execute: async (request) => {
      if (request.operation === "import.apply") {
        calls++;
        lost = true;
        throw new Error("lost response");
      }
      if (lost)
        return {
          ...receipt,
          state: "complete",
          result: {
            agents: [{ agentId: "created", name: "A" }],
            channels: [],
            skipped: [],
            skippedChannels: [],
            warnings: [],
          },
        };
      return receipt;
    },
  });
  await controller.refresh();
  await controller.apply("UTC");
  expect(calls).toBe(0);
  controller.select("keys", "a");
  await controller.apply("UTC");
  expect(controller.snapshot().uncertain).toBe(true);
  await controller.apply("UTC");
  expect(calls).toBe(1);
  await controller.refresh();
  expect(controller.snapshot().receipt?.state).toBe("complete");
  await controller.apply("UTC");
  expect(calls).toBe(1);
});
it("rejects oversized uploads before transfer and preview-token substitution", async () => {
  let uploads = 0;
  const controller = createAgentImport("host", {
    upload: async () => {
      uploads++;
      return { uploadId: "upload" };
    },
    execute: async () => receipt,
  });
  await controller.stage({ name: "export.zip", size: 104857601, source: null }, "req");
  expect(uploads).toBe(0);
  expect(() => decodeImportReceipt({ ...receipt, token: "other" })).toThrow("identity");
  await controller.refresh();
  controller.select("keys", "unknown");
  expect(controller.snapshot().keys).toEqual([]);
});
