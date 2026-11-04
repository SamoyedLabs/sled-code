import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { project, route } from "./ConversationProtocol.ts";

it.effect(
  "keeps rich message and reply attribution while stripping private fields recursively",
  () =>
    Effect.gen(function* () {
      const page = {
        agentId: "a",
        threadId: null,
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "m",
            author: "agent",
            text: "Done",
            status: "completed",
            createdAt: "now",
            replyToMessageId: "source",
            senderMember: { id: "member", name: "Human" },
            subagents: [{ title: "Research", status: "completed" }],
            future: {
              label: "artifact",
              access_token: "PRIVATE-CREDENTIAL-FIXTURE",
              previewUrl: "http://private",
            },
            uiBlock: {
              version: 1,
              blockId: "form",
              spec: {
                type: "form",
                fields: [{ id: "entry", kind: "text", label: "Access", secret: true }],
                actions: [{ id: "submit", label: "Submit" }],
              },
              state: { status: "pending" },
            },
          },
        ],
        references: {},
        pageInfo: { hasOlder: true, olderCursor: "opaque /+" },
      };
      const value = yield* project("conversation.page", page);
      expect(value).toMatchObject({
        messages: [
          {
            replyToMessageId: "source",
            senderMember: { name: "Human" },
            subagents: [{ title: "Research" }],
            future: { label: "artifact", previewUrl: null },
            uiBlock: { spec: { fields: [{ id: "entry", secret: true }] } },
          },
        ],
      });
      expect(JSON.stringify(value)).not.toContain("PRIVATE-CREDENTIAL-FIXTURE");
      expect(
        route({
          operation: "conversation.page",
          agentId: "a/b",
          anchor: { type: "before", cursor: "opaque /+" },
          limit: 20,
        }).path,
      ).toBe("/v1/agents/a%2Fb/conversation-page?limit=20&before=opaque+%2F%2B");
      const request = {
        operation: "thread.branch" as const,
        agentId: "a",
        taskId: null,
        messageId: "m",
        requestId: "same-on-retry",
      };
      expect(route(request).body).toEqual({
        agentId: "a",
        taskId: null,
        messageId: "m",
        requestId: "same-on-retry",
      });
    }),
);
