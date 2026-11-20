import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  WS_METHODS,
  clientRpcRequiredScopes,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { isRequest, publicRichValue, project, route } from "./ConversationProtocol.ts";
import { normalize } from "./CoreWire.ts";

it.effect(
  "search preserves source pagination and identity without leaking rich private fields",
  () =>
    Effect.gen(function* () {
      const request = route({
        operation: "conversation.search",
        query: "hello & botId=foreign",
        agentId: "bot/a",
        cursor: "cursor /+",
        limit: 50,
      });
      const url = new URL(request.path, "http://fixture.invalid");
      expect(url.pathname).toBe("/v1/messages/search");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: "hello & botId=foreign",
        botId: "bot/a",
        cursor: "cursor /+",
        limit: "50",
      });
      const raw = {
        results: [
          {
            botId: "bot",
            taskId: "task",
            message: {
              id: "message",
              author: "agent",
              text: "literal botId",
              status: "completed",
              createdAt: "now",
              senderBotId: "sender",
              future: { password: "PRIVATE", label: "kept" },
            },
          },
        ],
        total: 101,
        nextCursor: "next /+",
      };
      expect(yield* project("conversation.search", normalize(url.href, raw))).toMatchObject({
        results: [
          {
            agentId: "bot",
            taskId: "task",
            message: { senderAgentId: "sender", future: { label: "kept" } },
          },
        ],
        total: 101,
        nextCursor: "next /+",
      });
      expect(
        JSON.stringify(yield* project("conversation.search", normalize(url.href, raw))),
      ).not.toContain("PRIVATE");
      expect(() => normalize(url.href, { results: [{ botId: "one", agentId: "two" }] })).toThrow(
        "Ambiguous",
      );
    }),
);

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
      expect(
        route({
          operation: "conversation.page",
          agentId: "a/b",
          taskId: "task/a",
          deferDetails: true,
          anchor: { type: "latest" },
          limit: 50,
        }),
      ).toEqual({
        method: "POST",
        path: "/v1/sled/conversation/page",
        body: { agentId: "a/b", taskId: "task/a", anchor: { type: "latest" }, limit: 50 },
        conversationProjection: "conversation.page",
      });
      expect(
        route({
          operation: "conversation.detail",
          agentId: "a",
          taskId: "task",
          messageId: "m",
          field: "toolResult",
          offset: 16384,
          version: "a".repeat(64),
        }).body,
      ).toMatchObject({ agentId: "a", taskId: "task", messageId: "m", offset: 16384 });
    }),
);

it("preserves boolean secret-field metadata without exposing secret values", () => {
  expect(
    publicRichValue({
      isSecret: true,
      secret: true,
      password: "PRIVATE",
      nested: { isSecret: false, secret: "PRIVATE" },
    }),
  ).toEqual({ isSecret: true, secret: true, nested: { isSecret: false } });
});

it.effect("preserves the trace availability marker without inlining its body", () =>
  Effect.gen(function* () {
    const result = yield* project("conversation.page", {
      agentId: "agent",
      threadId: "thread",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "message",
          author: "assistant",
          text: "Done",
          status: "completed",
          createdAt: "2026-11-14T00:00:00Z",
          deferredFields: ["trace"],
        },
      ],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    });
    expect(result).toMatchObject({ messages: [{ deferredFields: ["trace"] }] });
    expect(
      route({
        operation: "conversation.detail",
        agentId: "agent",
        taskId: null,
        messageId: "message",
        field: "trace",
        offset: 0,
        version: null,
      }),
    ).toMatchObject({
      method: "POST",
      path: "/v1/sled/conversation/detail",
      body: {
        agentId: "agent",
        taskId: null,
        messageId: "message",
        field: "trace",
        offset: 0,
        version: null,
      },
    });
  }),
);

it.effect("uses the negotiated pins routes and verifies bounded pin and thread data", () =>
  Effect.gen(function* () {
    const agentId = "owned-fixture";
    const taskId = "archived-thread";
    const messageId = "pinned-message";
    expect(route({ operation: "conversation.pins.list", agentId })).toEqual({
      method: "POST",
      path: "/v1/message-pins/list",
      body: { agentId },
      conversationProjection: "conversation.pins.list",
    });
    expect(
      route({ operation: "conversation.pins.set", agentId, taskId, messageId, pinned: true }),
    ).toMatchObject({
      path: "/v1/message-pins/set",
      body: { agentId, taskId, messageId, pinned: true },
    });
    expect(
      route({ operation: "conversation.pins.readThread", agentId, taskId, messageId, limit: 50 }),
    ).toMatchObject({
      path: "/v1/message-pins/read-thread",
      body: { agentId, taskId, messageId, limit: 50 },
    });
    const pin = {
      messageId,
      taskId,
      threadTitle: "Archived",
      pinnedAt: "2026-11-20",
      pinnedBy: { kind: "person", sender: null },
      author: "agent",
      sender: null,
      senderAgentId: agentId,
      createdAt: "2026-11-20",
      text: "Scoped fixture.",
    };
    expect(
      yield* project("conversation.pins.set", {
        agentId,
        pins: [{ ...pin, credential: "stripped" }],
      }),
    ).toEqual({ agentId, pins: [pin] });
    expect(
      (yield* Effect.result(
        project("conversation.pins.list", { agentId, pins: [{ ...pin, text: "x".repeat(1001) }] }),
      ))._tag,
    ).toBe("Failure");
    expect(
      yield* project("conversation.pins.readThread", {
        hasOlder: true,
        hasNewer: true,
        conversation: {
          agentId,
          threadId: "archived",
          activeTurnId: null,
          revision: 7,
          messages: [
            {
              id: messageId,
              author: "assistant",
              text: "Scoped fixture.",
              status: "completed",
              createdAt: "2026-11-20",
              accessToken: "stripped",
            },
          ],
        },
      }),
    ).toMatchObject({
      hasOlder: true,
      hasNewer: true,
      conversation: { agentId, messages: [{ id: messageId, text: "Scoped fixture." }] },
    });
  }),
);

it.effect(
  "routes message-delete-v1 for main chats and side threads with scoped Sled authorization",
  () =>
    Effect.gen(function* () {
      const mainDelete = {
        operation: "conversation.message.delete" as const,
        agentId: "agent-1",
        taskId: null,
        messageId: "msg-1",
      };
      const taskDelete = {
        operation: "conversation.message.delete" as const,
        agentId: "agent-1",
        taskId: "task-9",
        messageId: "msg-2",
      };
      expect(isRequest(mainDelete)).toBe(true);
      expect(route(mainDelete)).toEqual({
        method: "POST",
        path: "/v1/messages/delete",
        body: { agentId: "agent-1", messageId: "msg-1" },
        conversationProjection: "conversation.message.delete",
      });
      expect(route(taskDelete)).toEqual({
        method: "POST",
        path: "/v1/messages/delete-task",
        body: { agentId: "agent-1", taskId: "task-9", messageId: "msg-2" },
        conversationProjection: "conversation.message.delete",
      });
      expect(yield* project("conversation.message.delete", {})).toEqual({});
      expect(
        clientRpcRequiredScopes(WS_METHODS.openbotWriteToHost, {
          hostId: "host-1",
          request: mainDelete,
        }),
      ).toEqual([AuthOrchestrationOperateScope]);
      expect(
        clientRpcRequiredScopes(WS_METHODS.openbotAdminToHost, {
          hostId: "host-1",
          request: taskDelete,
        }),
      ).toEqual([AuthSettingsWriteScope, AuthOrchestrationOperateScope]);
    }),
);
