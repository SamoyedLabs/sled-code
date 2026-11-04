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
    yield* session.apiRead({ operation: "conversation.read", agentId: "bot1" });
    yield* session.apiWrite({
      operation: "conversation.send",
      agentId: "bot1",
      text: "Check Canvas",
      clientMessageId: "message1",
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
      const apiUrl = yield* fixture(async (request, response) => {
        for await (const _chunk of request) {
          /* Drain the fixture request. */
        }
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login") {
          response.end(
            JSON.stringify({ sessionToken: "private-token", sessionExpiresAt: "2027-01-01" }),
          );
        } else if (request.url === "/v1/auth/logout") {
          response.writeHead(204).end();
        } else if (request.url === "/v1/mcp-servers/test") {
          response.end(JSON.stringify({ toolCount: 0, error: "private-header-value" }));
        } else {
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
      yield* session.close;
    }).pipe(
      Effect.provide(TeamClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.scoped,
    ),
);
