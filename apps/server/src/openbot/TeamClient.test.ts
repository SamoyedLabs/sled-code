import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
// @effect-diagnostics nodeBuiltinImport:off - Local HTTP fixtures exercise the upstream transport contract.
import * as NodeHttp from "node:http";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as TeamClient from "./TeamClient.ts";

const fixture = Effect.fnUntraced(function* (handle: NodeHttp.RequestListener) {
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeHttp.Server>((resolve, reject) => {
          const server = NodeHttp.createServer(handle);
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* Effect.die("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
});

it.live(
  "reads channel cursors and preserves acknowledged channel command identity and lifecycle",
  () =>
    Effect.gen(function* () {
      const channel = {
        id: "channel-one",
        name: "Team",
        title: "Shared work",
        instructions: "Coordinate the work",
        members: [{ agentId: "bot-one" }, { agentId: "unlisted-bot" }],
        leadAgentId: "unlisted-bot",
        archived: false,
        revision: 3,
        createdAt: "2026-11-04T00:00:00Z",
      };
      const task = {
        id: "task-one",
        channelId: channel.id,
        parentTaskId: null,
        rootTaskId: "task-one",
        ownerAgentId: "bot-one",
        requestMessageId: "message-one",
        instruction: "Investigate",
        attachmentDraftIds: [],
        expectedResult: "Report",
        sourceMessageIds: [],
        dependencies: [],
        resources: [],
        state: "running",
        revision: 1,
        assignmentCount: 1,
        error: null,
      };
      const operations = new Set<string>();
      const messages: unknown[] = [];
      let deleted = false;
      let sends = 0;
      let savedDraft: unknown;
      const apiUrl = yield* fixture(async (request, response) => {
        let text = "";
        for await (const chunk of request) text += chunk.toString();
        const body: unknown = text ? JSON.parse(text) : {};
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login") {
          response.end(
            JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
          );
          return;
        }
        if (request.url === "/v1/auth/logout") {
          response.writeHead(204).end();
          return;
        }
        if (typeof body !== "object" || body === null) {
          response.writeHead(400).end("{}");
          return;
        }
        if (request.url === "/v1/channels/read") {
          if (
            "beforeSequence" in body &&
            (typeof body.beforeSequence !== "number" || !Number.isSafeInteger(body.beforeSequence))
          ) {
            response.writeHead(400).end("{}");
            return;
          }
          if (deleted) {
            response.writeHead(404).end("{}");
            return;
          }
          response.end(
            JSON.stringify({
              channel,
              messages,
              tasks: [task],
              olderCursor: "beforeSequence" in body ? null : 4,
              throughSequence: 5,
              privateProviderState: "must-stay-private",
            }),
          );
          return;
        }
        if (request.url === "/v1/channels/delete") {
          if (
            !String(request.headers["openbot-capabilities"])
              .split(",")
              .includes("channel-delete-v1")
          ) {
            response.writeHead(400).end("{}");
            return;
          }
          deleted = true;
          response.writeHead(204).end();
          return;
        }
        if (
          request.url !== "/v1/channels/commands" ||
          !("operationId" in body) ||
          typeof body.operationId !== "string" ||
          !("type" in body)
        ) {
          response.writeHead(400).end("{}");
          return;
        }
        if (deleted) {
          response.writeHead(404).end("{}");
          return;
        }
        if (operations.has(body.operationId)) {
          response.end(JSON.stringify(channel));
          return;
        }
        if (body.type === "save") {
          if (
            !("draft" in body) ||
            typeof body.draft !== "object" ||
            body.draft === null ||
            !("name" in body.draft) ||
            typeof body.draft.name !== "string" ||
            !("update" in body) ||
            body.update !== true
          ) {
            response.writeHead(400).end("{}");
            return;
          }
          savedDraft = body.draft;
          channel.name = body.draft.name;
        } else if (body.type === "send") {
          if (
            !("text" in body) ||
            typeof body.text !== "string" ||
            !("recipientAgentId" in body) ||
            !("replyToMessageId" in body) ||
            !("attachmentDraftIds" in body)
          ) {
            response.writeHead(400).end("{}");
            return;
          }
          sends++;
          messages.push({
            id: "message-one",
            channelId: channel.id,
            sequence: 5,
            author: { kind: "member", id: "owner", name: "Owner" },
            taskId: task.id,
            superseded: false,
            message: {
              id: "message-one",
              author: "user",
              text: body.text,
              createdAt: channel.createdAt,
              status: "completed",
              privateSession: "must-stay-private",
            },
          });
        } else if (body.type === "archive") {
          channel.archived = true;
          task.state = "paused";
        } else if (body.type === "restore") channel.archived = false;
        else if (body.type === "stop") task.state = "paused";
        else if (body.type === "resume") task.state = "queued";
        else if (
          body.type === "reassign" &&
          "recipientAgentId" in body &&
          typeof body.recipientAgentId === "string"
        ) {
          task.ownerAgentId = body.recipientAgentId;
          task.state = "queued";
        } else if (body.type === "cancel") {
          if (
            !String(request.headers["openbot-capabilities"])
              .split(",")
              .includes("channel-task-cancel-v1") ||
            task.state !== "paused"
          ) {
            response.writeHead(400).end("{}");
            return;
          }
          task.state = "cancelled";
        }
        operations.add(body.operationId);
        channel.revision++;
        response.end(JSON.stringify(channel));
      });
      const client = yield* TeamClient.TeamClient;
      const session = yield* client.connect({ apiUrl, ownerSecret: "private-password" });
      const initial = yield* session.apiRead({ operation: "channel.read", channelId: channel.id });
      expect(initial).toMatchObject({ channel: { revision: 3 }, olderCursor: 4 });
      expect(initial).not.toHaveProperty("privateProviderState");
      expect(
        yield* session.apiRead({
          operation: "channel.read",
          channelId: channel.id,
          beforeSequence: 4,
        }),
      ).toMatchObject({ olderCursor: null });
      const draft = {
        name: "Renamed",
        title: channel.title,
        instructions: channel.instructions,
        members: channel.members,
        leadAgentId: channel.leadAgentId,
      };
      yield* session.apiAdmin({
        operation: "channel.save",
        channelId: channel.id,
        operationId: "save-one",
        draft,
        update: true,
      });
      expect(savedDraft).toEqual(draft);
      const send = {
        operation: "channel.send",
        channelId: channel.id,
        operationId: "send-one",
        text: "Investigate",
        recipientAgentId: "bot-one",
        replyToMessageId: null,
        attachmentDraftIds: [],
      } as const;
      yield* session.apiAdmin(send);
      yield* session.apiAdmin(send);
      expect(sends).toBe(1);
      yield* session.apiAdmin({
        operation: "channel.archive",
        channelId: channel.id,
        operationId: "archive-one",
      });
      yield* session.apiAdmin({
        operation: "channel.restore",
        channelId: channel.id,
        operationId: "restore-one",
      });
      const restored = yield* session.apiRead({ operation: "channel.read", channelId: channel.id });
      expect(restored).toMatchObject({
        channel: { name: "Renamed", archived: false },
        tasks: [{ state: "paused" }],
        messages: [{ message: { text: "Investigate" } }],
      });
      expect(JSON.stringify(restored)).not.toContain("must-stay-private");
      for (const operation of [
        "channel.resume",
        "channel.reassign",
        "channel.stop",
        "channel.cancel",
      ] as const)
        yield* session.apiAdmin({
          operation,
          channelId: channel.id,
          operationId: operation,
          taskId: task.id,
          recipientAgentId: operation === "channel.reassign" ? "unlisted-bot" : null,
        });
      expect(
        yield* session.apiRead({ operation: "channel.read", channelId: channel.id }),
      ).toMatchObject({ tasks: [{ state: "cancelled", ownerAgentId: "unlisted-bot" }] });
      expect(
        yield* session.apiAdmin({ operation: "channel.delete", channelId: channel.id }),
      ).toBeNull();
      expect(
        (yield* Effect.flip(
          session.apiAdmin({
            operation: "channel.save",
            channelId: channel.id,
            operationId: "late-save",
            draft,
            update: true,
          }),
        )).status,
      ).toBe(404);
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);

it.live("preserves workflow graph content through revision conflicts and stable run retries", () =>
  Effect.gen(function* () {
    const graph = {
      nodes: [
        {
          id: "future-node",
          kind: "trigger",
          at: { x: 10, y: 20 },
          fields: { trigger: "manual", futureOption: "keep this", count: 2, enabled: true },
          locked: true,
          size: { width: 200 },
          schedule: { kind: "once", date: "2027-01-01", time: "09:00" },
        },
      ],
      edges: [],
      strokes: [{ id: "drawing", brush: "pen", color: "blue", width: 2, points: [{ x: 0, y: 1 }] }],
    };
    const detail = {
      summary: {
        id: "workflow-1",
        title: "Triage",
        steps: 1,
        updatedAt: "2026-11-04T00:00:00Z",
        lastRun: null,
      },
      graph,
      revision: 7,
      triggers: [
        {
          nodeId: "future-node",
          type: "webhook",
          nextDueAt: null,
          webhookUrl: "https://example.invalid/hooks/private-fixture-secret",
        },
      ],
    };
    const publicDetail = {
      ...detail,
      triggers: detail.triggers.map((trigger) => ({ ...trigger, webhookUrl: null })),
    };
    const step = {
      id: "step-1",
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "future-node",
      attempt: 1,
      agentId: null,
      status: "approval",
      output: null,
      branch: null,
      error: null,
      startedAt: null,
      endedAt: null,
    };
    const run = {
      id: "run-1",
      workflowId: "workflow-1",
      number: 1,
      triggerNodeId: null,
      source: "manual",
      status: "approval",
      error: null,
      startedAt: "2026-11-04T00:00:00Z",
      endedAt: null,
    };
    let starts = 0;
    let seenRequestId: string | null = null;
    let savedGraph: unknown;
    const apiUrl = yield* fixture(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const body: unknown = text ? JSON.parse(text) : {};
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login") {
        response.end(
          JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
        );
        return;
      }
      if (request.url === "/v1/auth/logout") {
        response.writeHead(204).end();
        return;
      }
      if (!String(request.headers["openbot-capabilities"]).split(",").includes("workflows-v1")) {
        response.writeHead(400).end("{}");
        return;
      }
      if (request.url === "/v1/workflows/get") response.end(JSON.stringify(detail));
      else if (request.url === "/v1/workflows/save-graph") {
        if (
          typeof body !== "object" ||
          body === null ||
          !("baseRevision" in body) ||
          !("graph" in body)
        ) {
          response.writeHead(400).end("{}");
          return;
        }
        savedGraph = body.graph;
        response.end(
          JSON.stringify(
            body.baseRevision === 7 ? { ok: true, revision: 8 } : { ok: false, conflict: detail },
          ),
        );
      } else if (request.url === "/v1/workflows/start-run") {
        if (
          typeof body !== "object" ||
          body === null ||
          !("requestId" in body) ||
          typeof body.requestId !== "string"
        ) {
          response.writeHead(400).end("{}");
          return;
        }
        if (body.requestId !== seenRequestId) {
          starts++;
          seenRequestId = body.requestId;
        }
        response.end(JSON.stringify({ run, steps: [step] }));
      } else if (request.url === "/v1/workflows/decide") {
        if (
          typeof body === "object" &&
          body !== null &&
          "approved" in body &&
          body.approved === true
        )
          step.status = "done";
        response.end("{}");
      } else if (request.url === "/v1/workflows/run")
        response.end(JSON.stringify({ run, steps: [step] }));
      else response.writeHead(404).end("{}");
    });
    const client = yield* TeamClient.TeamClient;
    const session = yield* client.connect({ apiUrl, ownerSecret: "private-password" });
    expect(yield* session.apiRead({ operation: "workflow.get", workflowId: "workflow-1" })).toEqual(
      publicDetail,
    );
    expect(
      yield* session.apiAdmin({
        operation: "workflow.saveGraph",
        workflowId: "workflow-1",
        baseRevision: 6,
        graph,
      }),
    ).toEqual({ ok: false, conflict: publicDetail });
    expect(savedGraph).toEqual(graph);
    expect(
      yield* session.apiAdmin({
        operation: "workflow.saveGraph",
        workflowId: "workflow-1",
        baseRevision: 7,
        graph,
      }),
    ).toEqual({ ok: true, revision: 8 });
    const launch = {
      operation: "workflow.startRun",
      workflowId: "workflow-1",
      requestId: "stable-start",
    } as const;
    expect(yield* session.apiAdmin(launch)).toEqual({ run, steps: [step] });
    yield* session.apiAdmin(launch);
    expect(starts).toBe(1);
    yield* session.apiAdmin({ operation: "workflow.decide", stepId: "step-1", approved: true });
    expect(yield* session.apiRead({ operation: "workflow.run", runId: "run-1" })).toEqual({
      run,
      steps: [{ ...step, status: "done" }],
    });
    yield* session.close;
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.live("authenticates the local owner, lists a projected roster, and revokes the session", () =>
  Effect.gen(function* () {
    const requests: Array<{ path: string; authorization: string | undefined; body: string }> = [];
    const versions: Array<readonly [string | string[] | undefined, string | string[] | undefined]> =
      [];
    const apiUrl = yield* fixture(async (request, response) => {
      versions.push([
        request.headers["openbot-protocol-version"],
        request.headers["openbot-app-version"],
      ]);
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      requests.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body,
      });
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login") {
        response.end(
          JSON.stringify({
            sessionToken: "private-token",
            sessionExpiresAt: "2027-01-01T00:00:00.000Z",
          }),
        );
      } else if (request.url === "/v1/agents") {
        response.end(
          JSON.stringify([
            { id: "bot-1", name: "School", provider: "codex", workspacePath: "/private/workspace" },
          ]),
        );
      } else {
        response.writeHead(204).end();
      }
    });
    const client = yield* TeamClient.TeamClient;
    const session = yield* client.connect({ apiUrl, ownerSecret: "private-password" });
    expect(yield* session.listAgents).toEqual([{ id: "bot-1", name: "School", provider: "codex" }]);
    yield* session.close;
    expect(requests).toEqual([
      {
        path: "/v1/auth/login",
        authorization: undefined,
        body: JSON.stringify({ username: "owner", password: "private-password" }),
      },
      { path: "/v1/agents", authorization: "Bearer private-token", body: "" },
      { path: "/v1/auth/logout", authorization: "Bearer private-token", body: "" },
    ]);
    expect(versions).toEqual([
      ["9", "0.60.0"],
      ["9", "0.60.0"],
      ["9", "0.60.0"],
    ]);
    expect((yield* Effect.flip(session.listAgents)).reason).toBe("closed");
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.effect(
  "rejects nonlocal endpoints and embedded credentials before sending the owner password",
  () =>
    Effect.gen(function* () {
      const client = yield* TeamClient.TeamClient;
      for (const apiUrl of [
        "https://example.com",
        "http://localhost:8080",
        "http://127.0.0.1/redirect",
        "http://owner:password@127.0.0.1",
        "http://127.0.0.1?token=private",
      ]) {
        const failure = yield* Effect.flip(client.connect({ apiUrl, ownerSecret: "password" }));
        expect(failure.reason).toBe("invalid-configuration");
        expect(failure.message).not.toContain("password");
      }
    }).pipe(Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
);

it.live("refuses a redirect without forwarding the owner password", () =>
  Effect.gen(function* () {
    let destinationRequests = 0;
    const destination = yield* fixture((_request, response) => {
      destinationRequests++;
      response.end("{}");
    });
    const apiUrl = yield* fixture((_request, response) => {
      response.writeHead(307, { location: `${destination}/stolen` }).end();
    });
    const client = yield* TeamClient.TeamClient;
    const failure = yield* Effect.flip(client.connect({ apiUrl, ownerSecret: "private-password" }));
    expect(failure.reason).toBe("http");
    expect(failure.status).toBe(307);
    expect(destinationRequests).toBe(0);
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.live("rejects malformed or oversized rosters and keeps error payloads out of messages", () =>
  Effect.gen(function* () {
    let roster = JSON.stringify([{ id: "bot", name: 123, provider: "codex" }]);
    const apiUrl = yield* fixture((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login") {
        response.end(
          JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
        );
      } else if (request.url === "/v1/agents") {
        response.end(roster);
      } else {
        response.writeHead(204).end();
      }
    });
    const client = yield* TeamClient.TeamClient;
    const session = yield* client.connect({ apiUrl, ownerSecret: "private-password" });
    expect((yield* Effect.flip(session.listAgents)).reason).toBe("decode");
    roster = JSON.stringify([{ id: "bot", name: "x".repeat(1_048_576), provider: "codex" }]);
    expect((yield* Effect.flip(session.listAgents)).reason).toBe("decode");
    roster = "private-token private-password";
    const failure = yield* Effect.flip(session.listAgents);
    expect(failure.reason).toBe("decode");
    expect(failure.message).not.toContain("private-token");
    expect(failure.message).not.toContain("private-password");
    yield* session.close;
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.live("routes typed bot work through fixed endpoints with source-compatible bodies", () =>
  Effect.gen(function* () {
    const requests: Array<{
      method: string;
      path: string;
      body: unknown;
      capabilities: string | string[] | undefined;
    }> = [];
    const apiUrl = yield* fixture(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: text === "" ? null : JSON.parse(text),
        capabilities: request.headers["openbot-capabilities"],
      });
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login") {
        response.end(
          JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
        );
      } else if (request.method === "DELETE" || request.url === "/v1/auth/logout") {
        response.writeHead(204).end();
      } else if (request.url === "/v1/agent-tasks/start") {
        response.end(JSON.stringify({ id: "task1", agentId: "bot1", state: "queued" }));
      } else if (request.url === "/v1/agents/bot1/conversation") {
        response.end(
          JSON.stringify({
            botId: "bot1",
            threadId: null,
            activeTurnId: null,
            revision: 0,
            messages: [],
            references: { botId: { text: "literal reference key" } },
          }),
        );
      } else if (request.url === "/v1/agents/bot1/messages") {
        response.end(
          JSON.stringify({
            messageId: "accepted",
            deliveries: [{ recipientBotId: "bot1", status: "queued" }],
          }),
        );
      } else if (request.url === "/v1/agents/bot1/queue") {
        response.end(
          JSON.stringify({
            botId: "bot1",
            deliveries: [
              {
                id: "delivery",
                messageId: "message",
                status: "queued",
                position: 1,
                turnId: null,
                error: null,
                createdAt: "now",
                attachments: [],
                replyToMessageId: null,
                recipientBotId: "bot1",
                sender: { kind: "bot", botId: "sender" },
                text: "botId is literal text",
              },
            ],
          }),
        );
      } else {
        response.end("{}");
      }
    });
    const client = yield* TeamClient.TeamClient;
    const session = yield* client.connect({ apiUrl, ownerSecret: "private-password" });
    yield* session.apiRead({ operation: "agent.models" });
    yield* session.apiRead({ operation: "agent.status" });
    yield* session.apiAdmin({
      operation: "agent.create",
      input: {
        name: "School",
        description: "Assignments",
        initialMessage: "Wait for my tasks",
        provider: "codex",
      },
    });
    expect(yield* session.apiRead({ operation: "conversation.read", agentId: "bot1" })).toEqual({
      agentId: "bot1",
      threadId: null,
      activeTurnId: null,
      revision: 0,
      messages: [],
    });
    expect(
      yield* session.apiWrite({
        operation: "conversation.send",
        agentId: "bot1",
        text: "Check Canvas",
        clientMessageId: "message1",
      }),
    ).toEqual({
      messageId: "accepted",
      deliveries: [{ recipientAgentId: "bot1", status: "queued" }],
    });
    expect(yield* session.apiRead({ operation: "queue.read", agentId: "bot1" })).toEqual({
      agentId: "bot1",
      deliveries: [
        {
          id: "delivery",
          messageId: "message",
          status: "queued",
          position: 1,
          turnId: null,
          error: null,
          createdAt: "now",
          attachments: [],
          replyToMessageId: null,
          recipientAgentId: "bot1",
          sender: { kind: "agent", agentId: "sender" },
          text: "botId is literal text",
        },
      ],
    });
    expect(
      yield* session.apiWrite({
        operation: "task.start",
        agentId: "bot1",
        text: "Check syllabus",
        clientMessageId: "message2",
      }),
    ).toEqual({ id: "task1", agentId: "bot1", state: "queued" });
    yield* session.apiWrite({ operation: "task.stop", agentId: "bot1", taskId: "task1" });
    yield* session.apiAdmin({
      operation: "memory.update",
      agentId: "bot1",
      memoryId: "memory1",
      text: "My class meets Tuesday",
    });
    yield* session.apiAdmin({
      operation: "routine.create",
      agentId: "bot1",
      input: {
        name: "Morning",
        instruction: "Check assignments",
        active: true,
        timezone: "America/Chicago",
        schedule: { kind: "daily", time: "08:00" },
      },
    });
    expect(yield* session.apiAdmin({ operation: "agent.delete", agentId: "bot1" })).toBe(null);
    expect(requests.slice(1).map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/v1/agents/models", body: null },
      { method: "GET", path: "/v1/agents/status", body: null },
      {
        method: "POST",
        path: "/v1/agents",
        body: {
          name: "School",
          description: "Assignments",
          initialMessage: "Wait for my tasks",
          provider: "codex",
          avatarSeed: "sled",
          avatarHue: null,
        },
      },
      { method: "GET", path: "/v1/agents/bot1/conversation", body: null },
      {
        method: "POST",
        path: "/v1/agents/bot1/messages",
        body: {
          text: "Check Canvas",
          clientMessageId: "message1",
          attachmentDraftIds: [],
          replyToMessageId: null,
        },
      },
      { method: "GET", path: "/v1/agents/bot1/queue", body: null },
      {
        method: "POST",
        path: "/v1/agent-tasks/start",
        body: { agentId: "bot1", text: "Check syllabus", clientMessageId: "message2" },
      },
      { method: "POST", path: "/v1/agent-tasks/stop", body: { agentId: "bot1", taskId: "task1" } },
      {
        method: "PATCH",
        path: "/v1/agents/bot1/memories/memory1",
        body: { text: "My class meets Tuesday" },
      },
      {
        method: "POST",
        path: "/v1/agents/bot1/routines",
        body: {
          name: "Morning",
          instruction: "Check assignments",
          active: true,
          timezone: "America/Chicago",
          schedule: { kind: "daily", time: "08:00" },
        },
      },
      { method: "DELETE", path: "/v1/agents/bot1", body: null },
    ]);
    expect(
      requests.every(
        (request) =>
          typeof request.capabilities === "string" &&
          request.capabilities.split(",").includes("agent-tasks-v1") &&
          request.capabilities.split(",").includes("agent-create-model"),
      ),
    ).toBe(true);
    const count = requests.length;
    expect(
      (yield* Effect.flip(session.apiRead({ operation: "conversation.read", agentId: ".." })))
        .reason,
    ).toBe("invalid-configuration");
    expect(requests).toHaveLength(count);
    yield* session.close;
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.live(
  "projects stored MCP credentials and private server errors out of administration results",
  () =>
    Effect.gen(function* () {
      const privateTargets: unknown[] = [];
      const signInTargets: Array<{ path: string; body: unknown }> = [];
      const apiUrl = yield* fixture(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login") {
          response.end(
            JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
          );
        } else if (request.url === "/v1/auth/logout") {
          response.writeHead(204).end();
        } else if (request.url === "/v1/mcp-servers/test") {
          privateTargets.push(JSON.parse(body).config);
          response.end(JSON.stringify({ toolCount: 0, error: "private-header-value" }));
        } else if (request.url?.startsWith("/v1/admin/mcp-servers/sign-in/")) {
          signInTargets.push({ path: request.url, body: body ? JSON.parse(body) : null });
          response.end(
            JSON.stringify(
              request.url.endsWith("status")
                ? {
                    tabId: "host-private-tab",
                    result: { toolCount: 1, error: "private-header-value" },
                  }
                : { credentials: "private-header-value" },
            ),
          );
        } else {
          if (request.url === "/v1/mcp-servers/save") privateTargets.push(JSON.parse(body).config);
          response.end(
            JSON.stringify([
              {
                id: "sled",
                name: "Sled",
                transport: "http",
                enabled: true,
                url: "https://user:private-password@example.com/mcp?key=private-key",
                env: [{ key: "API_KEY", value: "private-env" }],
                headers: [{ key: "Authorization", value: "private-token" }],
                command: "private-command",
                args: ["private-argument"],
                envPassthrough: [],
                workingDirectory: "/private/folder",
              },
            ]),
          );
        }
      });
      const session = yield* (yield* TeamClient.TeamClient).connect({
        apiUrl,
        ownerSecret: "private-password",
      });
      const config = {
        id: "sled",
        name: "Sled",
        transport: "http" as const,
        enabled: true,
        url: "https://example.com/mcp",
        command: "",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        headers: [],
      };
      for (const input of [
        { operation: "mcp.list" } as const,
        { operation: "mcp.save", config } as const,
        { operation: "mcp.toggle", mcpServerId: "sled", enabled: true } as const,
        { operation: "mcp.delete", mcpServerId: "sled" } as const,
      ]) {
        expect(yield* session.apiAdmin(input)).toEqual([
          {
            id: "sled",
            name: "Sled",
            transport: "http",
            enabled: true,
            url: "https://example.com",
          },
        ]);
      }
      expect(yield* session.apiAdmin({ operation: "mcp.test", config })).toEqual({
        toolCount: 0,
        error: "The host MCP connection failed.",
      });
      expect(yield* session.apiAdmin({ operation: "mcp.testById", mcpServerId: "sled" })).toEqual({
        toolCount: 0,
        error: "The host MCP connection failed.",
      });
      expect(privateTargets.at(-1)).toMatchObject({
        url: "https://user:private-password@example.com/mcp?key=private-key",
        headers: [{ key: "Authorization", value: "private-token" }],
        env: [{ key: "API_KEY", value: "private-env" }],
      });
      expect(
        yield* session.apiAdmin({
          operation: "mcp.updateById",
          mcpServerId: "sled",
          patch: { name: "Renamed" },
        }),
      ).toEqual([
        { id: "sled", name: "Sled", transport: "http", enabled: true, url: "https://example.com" },
      ]);
      expect(privateTargets.at(-1)).toMatchObject({
        name: "Renamed",
        url: "https://user:private-password@example.com/mcp?key=private-key",
        env: [{ key: "API_KEY", value: "private-env" }],
        headers: [{ key: "Authorization", value: "private-token" }],
      });
      expect(
        yield* session.apiAdmin({ operation: "mcp.signIn.startById", mcpServerId: "sled" }),
      ).toEqual({});
      expect(
        yield* session.apiAdmin({ operation: "mcp.signIn.statusById", mcpServerId: "sled" }),
      ).toEqual({
        tabId: "host-private-tab",
        result: { toolCount: 1, error: "The host MCP connection failed." },
      });
      expect(
        yield* session.apiAdmin({ operation: "mcp.signIn.cancelById", mcpServerId: "sled" }),
      ).toEqual({});
      expect(signInTargets.map((entry) => entry.body)).toEqual([
        {
          config: expect.objectContaining({
            url: "https://user:private-password@example.com/mcp?key=private-key",
          }),
        },
        { url: "https://user:private-password@example.com/mcp?key=private-key" },
        { url: "https://user:private-password@example.com/mcp?key=private-key" },
      ]);
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);

it.live(
  "ensures messaging orchestrators with source-compatible scope and private response projection",
  () =>
    Effect.gen(function* () {
      const requests: Array<{ path: string; body: unknown; authorization: string | undefined }> =
        [];
      const apiUrl = yield* fixture(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        requests.push({
          path: request.url ?? "",
          body: body ? JSON.parse(body) : null,
          authorization: request.headers.authorization,
        });
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login")
          response.end(
            JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
          );
        else if (request.url === "/v1/auth/logout") response.writeHead(204).end();
        else if (request.url === "/v1/admin/connectors/messaging/disconnect") response.end("{}");
        else
          response.end(
            JSON.stringify({
              agentId: "shared-orchestrator",
              sectionId: null,
              privateToken: "must-not-leave-host",
            }),
          );
      });
      const session = yield* (yield* TeamClient.TeamClient).connect({
        apiUrl,
        ownerSecret: "private-password",
      });
      for (const request of [
        {
          operation: "connector.messaging.orchestrator",
          platform: "slack",
          workspaceId: "workspace-one",
        } as const,
        {
          operation: "connector.messaging.orchestrator",
          platform: "discord",
          workspaceId: "guild-one",
        } as const,
        {
          operation: "connector.messaging.orchestrator",
          platform: "telegram",
          workspaceId: null,
        } as const,
      ])
        expect(yield* session.apiAdmin(request)).toEqual({
          agentId: "shared-orchestrator",
          sectionId: null,
        });
      expect(
        yield* session.apiAdmin({
          operation: "connector.messaging.disconnect",
          platform: "telegram",
          workspaceId: "-10012345",
        }),
      ).toEqual({});
      expect(requests.slice(1)).toEqual([
        {
          path: "/v1/admin/connectors/messaging/orchestrator",
          body: { platform: "slack", workspaceId: "workspace-one" },
          authorization: "Bearer private-token",
        },
        {
          path: "/v1/admin/connectors/messaging/orchestrator",
          body: { platform: "discord", workspaceId: "guild-one" },
          authorization: "Bearer private-token",
        },
        {
          path: "/v1/admin/connectors/messaging/orchestrator",
          body: { platform: "telegram", workspaceId: null },
          authorization: "Bearer private-token",
        },
        {
          path: "/v1/admin/connectors/messaging/disconnect",
          body: { platform: "telegram", workspaceId: "-10012345" },
          authorization: "Bearer private-token",
        },
      ]);
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);

it.live(
  "keeps provider setup credentials write-only while preserving sign-in challenges and opaque models",
  () =>
    Effect.gen(function* () {
      const requests: Array<{
        path: string;
        body: unknown;
        capabilities: string | string[] | undefined;
      }> = [];
      const apiUrl = yield* fixture(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        requests.push({
          path: request.url ?? "",
          body: body ? JSON.parse(body) : null,
          capabilities: request.headers["openbot-capabilities"],
        });
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login") {
          response.end(
            JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
          );
        } else if (request.url === "/v1/admin/providers/accounts/list") {
          response.end(
            JSON.stringify({
              providers: [
                {
                  provider: "codex",
                  accounts: [
                    {
                      id: "default",
                      label: null,
                      email: "person@example.test",
                      state: "connected",
                      message: null,
                      accessToken: "stored-account-token",
                    },
                  ],
                },
              ],
              agents: [{ agentId: "bot1", accountId: "default" }],
              credentials: "stored-account-token",
            }),
          );
        } else if (request.url === "/v1/admin/providers/v8/code-login/start") {
          response.end(
            JSON.stringify({
              kind: "code",
              userCode: "ABCD-EFGH",
              verificationUrl: "https://auth.example.test/device",
              verificationUrlComplete: "https://auth.example.test/device?user_code=ABCD-EFGH",
              expiresAt: 1000,
              accessToken: "stored-account-token",
            }),
          );
        } else if (request.url === "/v1/admin/custom-agents/save") {
          response.end(
            JSON.stringify({
              agents: [
                {
                  id: "local",
                  name: "Local",
                  command: "node",
                  args: ["agent.mjs"],
                  envNames: ["API_KEY"],
                  usagePrompt: null,
                  resolvedCommand: "/usr/bin/node",
                  env: [{ name: "API_KEY", value: "write-only-env" }],
                },
              ],
              restart: "not-running",
            }),
          );
        } else if (request.url === "/v1/admin/sign-in-relay/provider-account/v2/start") {
          response.end(
            JSON.stringify({
              flowId: "flow1",
              expiresAt: 1000,
              refreshToken: "stored-account-token",
            }),
          );
        } else if (
          request.url === "/v1/admin/sign-in-relay/status" ||
          request.url === "/v1/admin/sign-in-relay/complete"
        ) {
          response.end(
            JSON.stringify({
              authorizeUrl: "https://auth.example.test/authorize?state=expected-state",
              callback: { port: 34567, path: "/callback", state: "expected-state" },
              result: request.url.endsWith("complete")
                ? { error: null }
                : body.includes("failed-flow")
                  ? { error: "stored-account-token" }
                  : null,
              refreshToken: "stored-account-token",
            }),
          );
        } else if (request.url === "/v1/admin/providers/accounts/sign-in/status") {
          response.end(
            JSON.stringify({
              tabId: "private-sign-in-tab",
              result: null,
              credentials: "stored-account-token",
            }),
          );
        } else {
          response.end(JSON.stringify({ apiKey: "write-only-provider-key" }));
        }
      });
      const session = yield* (yield* TeamClient.TeamClient).connect({
        apiUrl,
        ownerSecret: "private-password",
      });
      expect(yield* session.apiAdmin({ operation: "provider.accounts.list" })).toEqual({
        providers: [
          {
            provider: "codex",
            accounts: [
              {
                id: "default",
                label: null,
                email: "person@example.test",
                state: "connected",
                message: null,
              },
            ],
          },
        ],
        agents: [{ agentId: "bot1", accountId: "default" }],
      });
      expect(
        yield* session.apiAdmin({ operation: "provider.codeLogin.start", provider: "codex" }),
      ).toEqual({
        kind: "code",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.example.test/device",
        verificationUrlComplete: "https://auth.example.test/device?user_code=ABCD-EFGH",
        expiresAt: 1000,
      });
      expect(
        yield* session.apiAdmin({
          operation: "provider.apiKey.set",
          provider: "codex",
          key: "write-only-provider-key",
        }),
      ).toEqual({});
      expect(
        yield* session.apiAdmin({ operation: "provider.account.signIn.status", provider: "codex" }),
      ).toEqual({ tabId: "private-sign-in-tab", result: null });
      expect(
        yield* session.apiAdmin({
          operation: "provider.customAgent.save",
          input: {
            id: "local",
            name: "Local",
            command: "node",
            args: ["agent.mjs"],
            env: [{ name: "API_KEY", value: "write-only-env" }],
            usagePrompt: null,
          },
        }),
      ).toEqual({
        agents: [
          {
            id: "local",
            name: "Local",
            command: "node",
            args: ["agent.mjs"],
            envNames: ["API_KEY"],
            usagePrompt: null,
            resolvedCommand: "/usr/bin/node",
          },
        ],
        restart: "not-running",
      });
      yield* session.apiAdmin({
        operation: "agent.update",
        agentId: "bot1",
        input: {
          provider: "cursor",
          model: "gpt-test[context=272k,reasoning=medium,fast=false]",
          reasoningEffort: "ultra",
        },
      });
      expect(requests.at(-1)).toMatchObject({
        path: "/v1/agents/bot1",
        body: {
          provider: "cursor",
          model: "gpt-test[context=272k,reasoning=medium,fast=false]",
          reasoningEffort: "ultra",
        },
      });
      yield* session.apiAdmin({
        operation: "provider.account.assign",
        agentId: "bot1",
        accountId: "a1234567890abcdef",
      });
      expect(requests.at(-1)).toMatchObject({
        path: "/v1/admin/providers/accounts/agent",
        body: { agentId: "bot1", accountId: "a1234567890abcdef" },
      });
      expect(
        yield* session.apiAdmin({
          operation: "provider.account.signInRelay.start",
          provider: "codex",
          accountId: null,
        }),
      ).toEqual({ flowId: "flow1", expiresAt: 1000 });
      expect(
        yield* session.apiAdmin({ operation: "provider.signInRelay.status", flowId: "flow1" }),
      ).toEqual({
        authorizeUrl: "https://auth.example.test/authorize?state=expected-state",
        callback: { port: 34567, path: "/callback", state: "expected-state" },
        result: null,
      });
      expect(
        yield* session.apiAdmin({
          operation: "provider.signInRelay.status",
          flowId: "failed-flow",
        }),
      ).toMatchObject({ result: { error: "The provider sign-in failed." } });
      expect(
        yield* session.apiAdmin({
          operation: "provider.signInRelay.complete",
          flowId: "flow1",
          query: "code=one-time-code&state=expected-state",
        }),
      ).toMatchObject({ result: { error: null } });
      expect(requests.at(-1)).toMatchObject({
        path: "/v1/admin/sign-in-relay/complete",
        body: { flowId: "flow1", query: "code=one-time-code&state=expected-state" },
      });
      const count = requests.length;
      expect(
        (yield* Effect.flip(
          session.apiAdmin({
            operation: "provider.account.assign",
            agentId: "bot1",
            accountId: "invalid-account",
          }),
        )).reason,
      ).toBe("invalid-configuration");
      expect(requests).toHaveLength(count);
      expect(String(requests[1]?.capabilities)).toContain("provider-accounts-v1");
      expect(String(requests[1]?.capabilities)).toContain("providers-v8");
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);

it.live("renames browser profiles without rewriting their assignments or unknown metadata", () =>
  Effect.gen(function* () {
    let profile = {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Old",
      hue: 185,
      agentIds: ["bot1", "hidden-bot"],
      tabCount: 2,
      futureMetadata: { keep: true },
    };
    const origin = yield* fixture(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login") {
        response.end(
          JSON.stringify({ sessionToken: "owner", sessionExpiresAt: "2099-01-01T00:00:00Z" }),
        );
        return;
      }
      if (request.url === "/v1/admin/browser-profiles/update") {
        let text = "";
        for await (const chunk of request) text += chunk;
        const patch = JSON.parse(text);
        expect(patch).toEqual({ profileId: profile.id, name: "Renamed" });
        profile = { ...profile, name: patch.name };
        response.end(JSON.stringify(profile));
        return;
      }
      if (request.url === "/v1/admin/browser-profiles") {
        response.end(JSON.stringify({ profiles: [profile], sharedAgentIds: [] }));
        return;
      }
      if (request.url === "/v1/auth/logout") {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    const session = yield* (yield* TeamClient.TeamClient).connect({
      apiUrl: origin,
      ownerSecret: "fixture",
    });
    yield* session.apiAdmin({
      operation: "browser.profiles.update",
      profileId: profile.id,
      name: "Renamed",
    });
    expect(yield* session.apiAdmin({ operation: "browser.profiles.list" })).toMatchObject({
      profiles: [
        { name: "Renamed", agentIds: ["bot1", "hidden-bot"], futureMetadata: { keep: true } },
      ],
    });
    yield* session.close;
  }).pipe(
    Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
  ),
);

it.live(
  "dispatches history, host edit ownership, stale steer conflicts and retry-stable branches",
  () =>
    Effect.gen(function* () {
      const bodies: unknown[] = [];
      const apiUrl = yield* fixture(async (request, response) => {
        let text = "";
        for await (const chunk of request) text += chunk.toString();
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login") {
          response.end(JSON.stringify({ sessionToken: "private", sessionExpiresAt: "2027-01-01" }));
          return;
        }
        if (request.url === "/v1/auth/logout") {
          response.writeHead(204).end();
          return;
        }
        const body: unknown = text ? JSON.parse(text) : {};
        bodies.push(body);
        if (request.url?.startsWith("/v1/agents/a/conversation-page?")) {
          expect(request.url).toContain("before=opaque%2B");
          response.end(
            JSON.stringify({
              botId: "a",
              threadId: null,
              activeTurnId: "running",
              revision: 3,
              messages: [],
              references: {},
              pageInfo: { hasOlder: false, olderCursor: null },
            }),
          );
          return;
        }
        if (request.url === "/v1/agents/a/queue/edit") {
          response.end(JSON.stringify({ botId: "a", deliveries: [] }));
          return;
        }
        if (request.url === "/v1/agents/a/queue/steer") {
          response.writeHead(409).end("{}");
          return;
        }
        if (request.url === "/v1/agent-threads/branch") {
          response.end(
            JSON.stringify({
              id: "branch",
              branch: {
                sourceTaskId: null,
                sourceMessageId: "m",
                throughMessageId: "m",
                sourceTitle: null,
              },
            }),
          );
          return;
        }
        response.writeHead(404).end("{}");
      });
      const session = yield* (yield* TeamClient.TeamClient).connect({
        apiUrl,
        ownerSecret: "fixture",
      });
      expect(
        yield* session.apiRead({
          operation: "conversation.page",
          agentId: "a",
          anchor: { type: "before", cursor: "opaque+" },
          limit: 20,
        }),
      ).toMatchObject({ agentId: "a", revision: 3 });
      expect(
        yield* session.apiWrite({
          operation: "queue.edit",
          agentId: "a",
          deliveryId: "d",
          editId: "editor",
          action: "begin",
        }),
      ).toMatchObject({ agentId: "a" });
      const conflict = yield* Effect.flip(
        session.apiWrite({
          operation: "queue.steer",
          agentId: "a",
          deliveryId: "d",
          expectedTurnId: "old",
        }),
      );
      expect(conflict.status).toBe(409);
      const branch = {
        operation: "thread.branch" as const,
        agentId: "a",
        taskId: null,
        messageId: "m",
        requestId: "retry-id",
      };
      yield* session.apiWrite(branch);
      yield* session.apiWrite(branch);
      expect(bodies.slice(-2)).toEqual([
        { agentId: "a", taskId: null, messageId: "m", requestId: "retry-id" },
        { agentId: "a", taskId: null, messageId: "m", requestId: "retry-id" },
      ]);
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);

it.effect(
  "dispatches events, flows, vault and computer commands through the pinned capability boundary",
  () => {
    const paths: string[] = [];
    let tableStatus = 200;
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === "/v1/auth/login")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ sessionToken: "fixture", sessionExpiresAt: "2027-01-01" }),
          );
        for (const capability of [
          "shared-tables-v1",
          "hosted-sites-v1",
          "vault-v1",
          "vault-v2",
          "vault-import-v1",
          "onepassword-connector-v1",
          "bitwarden-connector-v1",
          "remote-desktop-setup",
        ])
          expect(request.headers["openbot-capabilities"]).toContain(capability);
        if (path === "/v1/admin/shared-tables/list")
          return HttpClientResponse.fromWeb(
            request,
            Response.json(
              tableStatus === 200
                ? [
                    {
                      name: "owned",
                      ownerAgentId: null,
                      rowCount: 2,
                      rows: ["private"],
                      sql: "private",
                    },
                  ]
                : { private: "must not escape" },
              { status: tableStatus },
            ),
          );
        if (path === "/v1/hosted-sites/list")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ sites: [], used: 0, limit: 0, credential: "private" }),
          );
        if (path === "/v1/admin/shared-tables/delete" || path === "/v1/hosted-sites/delete")
          return HttpClientResponse.fromWeb(request, Response.json({}));
        if (path === "/v1/admin/vault/v2/list")
          return HttpClientResponse.fromWeb(request, Response.json({ status: "ready", items: [] }));
        if (path === "/v1/remote-screen/setup")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              platform: "darwin",
              hostName: "fixture",
              username: "fixture",
              checkedAt: null,
              screenRecording: "not-checked",
              accessibility: "not-checked",
              service: "not-checked",
              displays: "not-checked",
              guiSession: "not-checked",
              restartRequired: false,
              activeSessions: 0,
              message: null,
            }),
          );
        if (path === "/v1/remote-screen/display") {
          expect(request.method).toBe("PUT");
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
        }
        expect(request.headers["openbot-capabilities"]).toContain("routine-recovery-v1");
        expect(request.headers["openbot-capabilities"]).toContain("routine-flows-v1");
        if (path === "/v1/admin/events/status")
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ supported: true, connected: true }),
          );
        if (path === "/v1/admin/routine-recovery/runs")
          return HttpClientResponse.fromWeb(request, Response.json([]));
        if (path === "/v1/routine-flows/positions/save")
          return HttpClientResponse.fromWeb(request, Response.json({}));
        return HttpClientResponse.fromWeb(request, new Response("{}", { status: 404 }));
      }),
    );
    return Effect.gen(function* () {
      const client = yield* TeamClient.TeamClient;
      const session = yield* client.connect({
        apiUrl: "http://127.0.0.1:12345",
        ownerSecret: "fixture",
      });
      expect(yield* session.apiAdmin({ operation: "events.status" })).toEqual({
        supported: true,
        connected: true,
      });
      expect(
        yield* session.apiAdmin({
          operation: "events.runs",
          owner: { kind: "channel", id: "channel" },
          routineId: "routine",
        }),
      ).toEqual([]);
      yield* session.apiWrite({
        operation: "routineFlow.savePosition",
        agentId: "a",
        nodeKey: "agent:b",
        x: 10,
        y: 20,
      });
      expect(yield* session.apiAdmin({ operation: "vault.list", version: "v2" })).toEqual({
        status: "ready",
        items: [],
      });
      expect(yield* session.apiAdmin({ operation: "computer.setup" })).toMatchObject({
        hostName: "fixture",
        activeSessions: 0,
      });
      expect(yield* session.apiAdmin({ operation: "computer.display", displayId: "1" })).toBeNull();
      expect(paths).toEqual([
        "/v1/auth/login",
        "/v1/admin/events/status",
        "/v1/admin/routine-recovery/runs",
        "/v1/routine-flows/positions/save",
        "/v1/admin/vault/v2/list",
        "/v1/remote-screen/setup",
        "/v1/remote-screen/display",
      ]);
      expect(yield* session.apiRead({ operation: "tables.list" })).toEqual([
        { name: "owned", ownerAgentId: null, rowCount: 2 },
      ]);
      expect(yield* session.apiRead({ operation: "sites.list" })).toEqual({
        sites: [],
        used: 0,
        limit: 0,
      });
      expect(yield* session.apiAdmin({ operation: "tables.delete", name: "owned" })).toEqual({});
      expect(yield* session.apiAdmin({ operation: "sites.delete", siteId: "owned" })).toEqual({});
      for (const [status, error] of [
        [400, "unsupported"],
        [403, "forbidden"],
        [409, "account-or-conflict"],
        [500, "request-failed"],
      ] as const) {
        tableStatus = status;
        expect(yield* session.apiRead({ operation: "tables.list" })).toEqual({ dataError: error });
      }
      tableStatus = 401;
      const expired = yield* session.apiRead({ operation: "tables.list" }).pipe(Effect.result);
      expect(expired._tag).toBe("Failure");
      if (expired._tag === "Failure")
        expect(expired.failure).toMatchObject({ reason: "http", status: 401 });
    }).pipe(Effect.provide(TeamClient.layer), Effect.provideService(HttpClient.HttpClient, http));
  },
);
