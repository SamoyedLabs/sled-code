import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { OpenbotAdminRequest } from "@t3tools/contracts";
import {
  botConnectionResult,
  botMessagingGrant,
  botMcpRequest,
  botMcpPatchRequest,
  botMessagingOrchestrator,
  botMessagingOrchestratorRequest,
  EMPTY_BOT_CONNECTIONS,
  EMPTY_BOT_MCP_DRAFT,
} from "./connections.ts";
const isAdminRequest = Schema.is(OpenbotAdminRequest);

it("keeps saved MCP configuration private through edits and follow-up refreshes", () => {
  const projected = botConnectionResult(EMPTY_BOT_CONNECTIONS, { operation: "mcp.list" }, [
    {
      id: "tools",
      name: "Tools",
      transport: "http",
      enabled: true,
      url: "https://example.test",
      headers: [{ key: "Authorization", value: "stored-private-token" }],
    },
  ]);
  expect(projected?.mcps).toEqual([
    { id: "tools", name: "Tools", transport: "http", enabled: true, url: "https://example.test" },
  ]);
  expect(botMcpPatchRequest("tools", '{"name":"New name"}')).toEqual({
    operation: "mcp.updateById",
    mcpServerId: "tools",
    patch: { name: "New name" },
  });
  expect(botMcpPatchRequest("tools", '{"headers":[]}')).toEqual({
    operation: "mcp.updateById",
    mcpServerId: "tools",
    patch: { headers: [] },
  });
  expect(botMcpPatchRequest("tools", '{"id":"another-host","name":"New"}')).toBeNull();
  expect(botMcpPatchRequest("tools", '{"env":{"API_KEY":"bad-format"}}')).toBeNull();
  const tested = botConnectionResult(
    EMPTY_BOT_CONNECTIONS,
    { operation: "mcp.testById", mcpServerId: "tools" },
    { toolCount: 2, error: null },
  );
  expect(tested).not.toBeNull();
  if (!tested) return;
  expect(botConnectionResult(tested, { operation: "mcp.signIn.list" }, [])?.notice).toBe(
    "Connected: 2 tools.",
  );
});

it("inspects shared Telegram and per-workspace orchestrators without crossing platforms", () => {
  const connection = {
    workspaceId: "one",
    platform: "slack" as const,
    enabled: true,
    state: "connected",
    workspaceName: "One",
    missingScopes: [],
    retryAt: null,
    credentials: "stored",
    orchestratorAgentId: "old",
  };
  const agents = [
    { id: "old", name: "Original", provider: "codex" },
    { id: "shared", name: "Shared", provider: "opencode" },
  ];
  const rows = [connection, { ...connection, workspaceId: "two", orchestratorAgentId: "shared" }];
  expect(botMessagingOrchestrator("slack", "one", rows, agents)?.id).toBe("old");
  expect(botMessagingOrchestrator("slack", "missing", rows, agents)).toBeNull();
  expect(botMessagingOrchestrator("discord", "one", rows, agents)).toBeNull();
  const telegram = rows.map((row) => ({ ...row, platform: "telegram" as const }));
  expect(botMessagingOrchestrator("telegram", "two", telegram, agents)?.id).toBe("old");
  expect(botMessagingOrchestrator("telegram", "two", telegram, agents.slice(1))?.id).toBe("shared");
  expect(botMessagingOrchestratorRequest("slack", "one")).toEqual({
    operation: "connector.messaging.orchestrator",
    platform: "slack",
    workspaceId: "one",
  });
  expect(botMessagingOrchestratorRequest("telegram", "two")).toEqual({
    operation: "connector.messaging.orchestrator",
    platform: "telegram",
    workspaceId: null,
  });
  expect(botMessagingOrchestratorRequest("slack", "")).toBeNull();
  expect(botMessagingOrchestratorRequest("discord", "a".repeat(129))).toBeNull();
  expect(
    isAdminRequest({
      operation: "connector.messaging.orchestrator",
      platform: "slack",
      workspaceId: null,
    }),
  ).toBe(false);
  expect(
    isAdminRequest({
      operation: "connector.messaging.disconnect",
      platform: "telegram",
      workspaceId: "-10012345",
    }),
  ).toBe(true);
  expect(
    botConnectionResult(
      EMPTY_BOT_CONNECTIONS,
      { operation: "connector.messaging.orchestrator", platform: "slack", workspaceId: "one" },
      { agentId: "shared", sectionId: null, apiKey: "private-value" },
    )?.notice,
  ).toBe("Orchestrator ready: shared.");
  expect(
    botConnectionResult(
      EMPTY_BOT_CONNECTIONS,
      { operation: "connector.messaging.orchestrator", platform: "slack", workspaceId: "one" },
      { agentId: null, sectionId: null },
    ),
  ).toBeNull();
});

it("preserves literal tool arguments and rejects invalid private drafts", () => {
  const draft = {
    ...EMPTY_BOT_MCP_DRAFT,
    name: "Local",
    transport: "stdio" as const,
    command: "node",
    args: '["/a path/agent.mjs","$(literal)"]',
    env: '{"API_KEY":"new-private-value"}',
  };
  expect(botMcpRequest(draft)).toMatchObject({
    operation: "mcp.save",
    config: {
      id: "",
      command: "node",
      args: ["/a path/agent.mjs", "$(literal)"],
      env: [{ key: "API_KEY", value: "new-private-value" }],
    },
  });
  expect(botMcpRequest({ ...draft, args: "--shell string" })).toBeNull();
  for (const url of ["javascript:alert(1)", "https://user:password@example.test/mcp"]) {
    expect(botMcpRequest({ ...EMPTY_BOT_MCP_DRAFT, name: "Remote", url })).toBeNull();
  }
});

it("binds messaging grants to one platform, nonce and unambiguous return URL", () => {
  const callback = "openbot://slack-workspace?nonce=expected&grant=private-grant";
  expect(botMessagingGrant("slack", callback, "expected")).toEqual({
    operation: "connector.messaging.complete",
    platform: "slack",
    nonce: "expected",
    grant: "private-grant",
  });
  for (const value of [
    callback,
    callback.replace("slack-workspace", "discord-guild"),
    `${callback}&nonce=other`,
    `${callback}&grant=other`,
    callback.replace("slack-workspace", "user@slack-workspace"),
    `${callback}#unexpected`,
  ]) {
    expect(botMessagingGrant("slack", value, value === callback ? "wrong" : "expected")).toBeNull();
  }
  expect(
    botConnectionResult(
      EMPTY_BOT_CONNECTIONS,
      { operation: "connector.messaging.overview", platform: "slack" },
      {
        connections: [
          {
            workspaceId: "discord",
            platform: "discord",
            enabled: true,
            state: "connected",
            workspaceName: "Other",
            missingScopes: [],
            retryAt: null,
            credentials: "stored",
            orchestratorAgentId: null,
          },
        ],
      },
    ),
  ).toBeNull();
  expect(
    botConnectionResult(
      EMPTY_BOT_CONNECTIONS,
      { operation: "connector.messaging.connect", platform: "slack", place: "group" },
      { url: "javascript:alert(1)", nonce: "expected" },
    ),
  ).toBeNull();
});

it("forgets repository metadata when the connected GitHub identity changes", () => {
  const github = {
    available: true,
    state: "connected" as const,
    login: "first",
    userCode: null,
    verificationUri: null,
    installUrl: null,
    revokeUrl: null,
    error: null,
  };
  const state = {
    ...EMPTY_BOT_CONNECTIONS,
    github,
    repositories: { repositories: [{ fullName: "first/private", private: true }], total: 1 },
  };
  expect(
    botConnectionResult(
      state,
      { operation: "connector.github.status" },
      { ...github, login: "second" },
    )?.repositories,
  ).toBeNull();
  expect(
    botConnectionResult(
      state,
      { operation: "connector.github.disconnect" },
      { ...github, state: "disconnected", login: null },
    )?.repositories,
  ).toBeNull();
});
