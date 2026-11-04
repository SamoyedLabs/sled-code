import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer, McpSchema } from "effect/ai";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as Integration from "../../../openbot/Integration.ts";

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "openbot-fixture", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "openbot-fixture", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("fixture-environment"),
  requestNamespace: "client:fixture",
  thread: undefined,
  client: { sessionId: "fixture", label: "Bot", access: "read-only" },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};
const layer = McpHttpServer.layerOpenbotToolkit.pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(liveThreadsLayer),
  Layer.provide(
    Layer.mock(Integration.Integration)({
      status: Effect.succeed({ state: "disabled" }),
      apiAdmin: () => Effect.die("read-only callers must not reach administration"),
    }),
  ),
);

it.effect("lets a read-only bot discover the request schemas and observe engine state", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const description = yield* server.callTool({
      name: "openbot",
      arguments: { action: "describe" },
    });
    expect(description.isError).not.toBe(true);
    expect(description.structuredContent).toHaveProperty("upstreamVersion", "0.60.0");
    const status = yield* server.callTool({ name: "openbot", arguments: { action: "status" } });
    expect(status.structuredContent).toEqual({ state: "disabled" });
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(layer),
  ),
);

it.effect.each([
  { name: "openbot", action: "admin" },
  { name: "openbot", action: "attention.respond" },
  { name: "openbot", action: "upstream.check" },
  { name: "openbot", action: "upstream.stage" },
  { name: "openbot_coding", action: "launch" },
])("blocks read-only clients from mutation through $name $action", ({ name, action }) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({
      name,
      arguments: { action, request: {} },
    });
    expect(result.isError).toBe(true);
    const text = result.content.find((item) => item.type === "text");
    expect(text?.type === "text" ? text.text : "").toContain("capability_denied");
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(layer),
  ),
);
