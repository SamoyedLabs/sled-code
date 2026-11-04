import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { OpenbotQueueCommand } from "@t3tools/contracts";
import { route } from "./QueueProtocol.ts";
it("preserves expected turn and edit ownership instead of replacing them with transport identities", () => {
  expect(
    route({ operation: "queue.steer", agentId: "a", deliveryId: "d", expectedTurnId: "running" }),
  ).toMatchObject({
    path: "/v1/agents/a/queue/steer",
    body: { deliveryId: "d", expectedTurnId: "running" },
  });
  expect(
    route({
      operation: "queue.edit",
      agentId: "a",
      deliveryId: "d",
      editId: "same-editor",
      action: "save",
      text: "Changed",
      keepAttachmentIds: ["old"],
      attachmentDraftIds: ["new"],
    }).body,
  ).toEqual({
    deliveryId: "d",
    editId: "same-editor",
    action: "save",
    text: "Changed",
    keepAttachmentIds: ["old"],
    attachmentDraftIds: ["new"],
  });
  const decode = Schema.decodeUnknownResult(OpenbotQueueCommand);
  expect(
    Result.isFailure(decode({ operation: "queue.steer", agentId: "a", deliveryId: "d" })),
  ).toBe(true);
  expect(
    Result.isFailure(decode({ operation: "queue.reorder", agentId: "a", deliveryIds: ["d", "d"] })),
  ).toBe(true);
});
