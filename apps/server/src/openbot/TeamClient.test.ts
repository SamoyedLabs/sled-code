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
