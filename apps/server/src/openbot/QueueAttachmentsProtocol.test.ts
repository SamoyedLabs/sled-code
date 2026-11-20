import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { dispatch } from "./QueueAttachmentsProtocol.ts";
import { queueAttachmentRequestHash } from "./QueueAttachmentsIdentity.ts";
import {
  signQueueAttachmentsBinding,
  verifyQueueAttachmentsBinding,
} from "./QueueAttachmentsBinding.ts";
import { verifyFilesPrincipalBinding } from "./FilesPrincipalBinding.ts";
it.effect("requires the new capability and exact canonical receipt without legacy fallback", () =>
  Effect.gen(function* () {
    const identity = {
      operationId: "u",
      hostId: "h",
      agentId: "a",
      threadId: "t",
      taskId: null,
      name: "f.txt",
      mimeType: "text/plain",
      size: 1,
      sha256: "a".repeat(64),
    };
    const input = {
      environmentId: "e",
      hostId: "h",
      agentId: "a",
      threadId: "t",
      taskId: null,
      deliveryId: "d",
      editId: "edit",
      expectedRevision: "b".repeat(64),
      text: "new text",
      keepAttachmentIds: [],
      uploads: [{ identity, draftId: "draft" }],
    };
    let posts = 0;
    const receipt = {
      requestHash: queueAttachmentRequestHash(input, "p"),
      deliveryId: "d",
      editId: "edit",
      expectedRevision: input.expectedRevision,
      messageId: "m",
      attachments: [],
    };
    const ports = {
      principal: "p",
      capabilities: new Set<string>(),
      authorize: () => Effect.void,
      post: (path: string, body: string) =>
        Effect.sync(() => {
          posts++;
          expect(path).toBe("/v1/sled/queue-attachments/result");
          expect(body).toContain("uploads");
          return receipt;
        }),
    };
    expect((yield* Effect.result(dispatch(input, true, ports)))._tag).toBe("Failure");
    expect(posts).toBe(0);
    ports.capabilities.add("sled-queue-attachments-v1");
    expect(yield* dispatch(input, true, ports)).toEqual(receipt);
    expect(
      (yield* Effect.result(dispatch({ ...input, text: "different" }, true, ports)))._tag,
    ).toBe("Failure");
    expect(yield* dispatch(input, true, { ...ports, post: () => Effect.succeed(null) })).toBeNull();
  }),
);
it("separates queue signature domain and exact body/path/host from Files", () => {
  const request = {
    principal: "p",
    hostId: "h",
    method: "POST",
    path: "/v1/sled/queue-attachments/save",
    bodySha256: "a".repeat(64),
  };
  const token = signQueueAttachmentsBinding("secret", request, 100);
  expect(verifyQueueAttachmentsBinding("secret", token, request, 101)).toBe("p");
  expect(() =>
    verifyQueueAttachmentsBinding("secret", token, { ...request, bodySha256: "b".repeat(64) }, 101),
  ).toThrow();
  expect(() =>
    verifyQueueAttachmentsBinding(
      "secret",
      token,
      { ...request, path: "/v1/sled/queue-attachments/result" },
      101,
    ),
  ).toThrow();
  expect(() =>
    verifyQueueAttachmentsBinding("secret", token, { ...request, hostId: "other" }, 101),
  ).toThrow();
  expect(() =>
    verifyFilesPrincipalBinding("secret", token, { ...request, path: "/v1/sled/files/send" }, 101),
  ).toThrow();
});
