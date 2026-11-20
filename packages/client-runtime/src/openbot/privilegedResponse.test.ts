import { describe, expect, it } from "vite-plus/test";
import {
  createPrivilegedResponseController,
  type PrivilegedResponseScope,
} from "./privilegedResponse.ts";
const scope: PrivilegedResponseScope = {
  principal: "p",
  environmentId: "e",
  hostId: "h",
  target: {
    agentId: "a",
    threadId: "t",
    turnId: "u",
    messageId: "m",
    blockId: "b",
    requestId: "r",
  },
};
describe("privileged response lifetime", () => {
  it("does not replay a lost response and refuses a changed principal", async () => {
    let current: PrivilegedResponseScope | null = scope;
    const operations: string[] = [];
    const controller = createPrivilegedResponseController(scope, {
      current: () => current,
      execute: async (request) => {
        operations.push(request.operation);
        if (request.operation === "privilegedResponse.respond") throw new Error("synthetic-secret");
        return {
          nonce: "n",
          status: request.operation === "privilegedResponse.context" ? "pending" : "answered",
        };
      },
    });
    await controller.prepare();
    expect(
      await controller.submit({ actionId: "submit", values: { key: "synthetic-secret" } }),
    ).toEqual({ nonce: "n", status: "unknown" });
    expect(await controller.submit({ actionId: "submit" })).toBeNull();
    expect(await controller.result()).toEqual({ nonce: "n", status: "answered" });
    current = { ...scope, principal: "replacement" };
    expect(await controller.result()).toBeNull();
    expect(operations).toEqual([
      "privilegedResponse.context",
      "privilegedResponse.respond",
      "privilegedResponse.result",
    ]);
    controller.close();
    current = scope;
    expect(await controller.prepare()).toBeNull();
  });
});
