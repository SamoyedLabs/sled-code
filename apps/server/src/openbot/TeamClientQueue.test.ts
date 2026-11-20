import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as TeamClient from "./TeamClient.ts";
it.effect(
  "negotiates guarded queue context and returns explicit HTTP refusal without losing its status",
  () => {
    let status = 200;
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        const path = new URL(request.url).pathname;
        if (path === "/v1/auth/login")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ sessionToken: "fixture", sessionExpiresAt: "2027-01-01" }),
          );
        expect(request.headers["openbot-capabilities"]?.split(",")).toContain(
          "sled-queue-attachments-v1",
        );
        if (path === "/v1/compatibility")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ capabilities: ["sled-queue-attachments-v1"] }),
          );
        expect(
          ["context", "save", "result"].some(
            (action) => path === `/v1/sled/queue-attachments/${action}`,
          ),
        ).toBe(true);
        expect(request.headers["x-sled-queue-attachments"]).toBeTruthy();
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            status === 200
              ? { expectedRevision: "a".repeat(64), text: "original", keepAttachmentIds: [] }
              : { error: "Original queue refused" },
            { status },
          ),
        );
      }),
    );
    return Effect.gen(function* () {
      const session = yield* (yield* TeamClient.TeamClient).connect({
        apiUrl: "http://127.0.0.1:1234",
        ownerSecret: "fixture",
      });
      const context = session.files.queueAttachmentContext;
      if (!context) return yield* Effect.die("Guarded queue context missing");
      const input = {
        environmentId: "environment",
        hostId: "host",
        agentId: "agent",
        threadId: "thread",
        taskId: null,
        deliveryId: "delivery",
        editId: "edit",
      };
      expect(yield* context("principal", input)).toEqual({
        expectedRevision: "a".repeat(64),
        text: "original",
        keepAttachmentIds: [],
      });
      status = 400;
      const failure = yield* Effect.flip(context("principal", input));
      expect(failure).toMatchObject({ reason: "http", status: 400 });
      const edit = session.files.queueAttachments;
      if (!edit) return yield* Effect.die("Guarded queue edit missing");
      const request = {
        ...input,
        expectedRevision: "a".repeat(64),
        text: "edited",
        keepAttachmentIds: [],
        uploads: [
          {
            draftId: "draft",
            identity: {
              operationId: "upload",
              hostId: "host",
              agentId: "agent",
              threadId: "thread",
              taskId: null,
              name: "f.txt",
              mimeType: "text/plain",
              size: 3,
              sha256: "b".repeat(64),
            },
          },
        ],
      };
      for (const lookup of [false, true])
        expect(yield* Effect.flip(edit("principal", request, lookup))).toMatchObject({
          reason: "http",
          status: 400,
        });
    }).pipe(Effect.provide(TeamClient.layer), Effect.provideService(HttpClient.HttpClient, http));
  },
);
