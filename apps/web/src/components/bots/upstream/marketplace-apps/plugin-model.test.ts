import { describe, expect, it } from "vite-plus/test";
import { MARKETPLACE_PLUGINS, createPluginAppConfig } from "./plugin-catalog";
import { isPluginAppConfig } from "./plugin-model";
import { applyMcpFlow, isListingUrl } from "./mcp-connect-flows";
import { mcpAccountUrl } from "./mcp-accounts";
describe("source plugin identity and credentials", () => {
  it("does not claim a manually configured server that shares a catalog name", () => {
    const app = MARKETPLACE_PLUGINS.flatMap((plugin) => plugin.apps).find(
      (app) => app.server.transport === "stdio",
    );
    if (!app) throw new Error("Missing stdio fixture");
    const config = createPluginAppConfig(app);
    expect(isPluginAppConfig(config, app)).toBe(true);
    expect(isPluginAppConfig({ ...config, args: [...config.args, "--other"] }, app)).toBe(false);
    expect(isPluginAppConfig({ ...config, command: "other" }, app)).toBe(false);
  });
  it("matches only source account fragments and allows listing-owned user links", () => {
    const app = MARKETPLACE_PLUGINS.flatMap((plugin) => plugin.apps).find(
      (app) =>
        app.server.transport === "http" && app.server.auth?.some((flow) => flow.kind === "link"),
    );
    if (!app) throw new Error("Missing HTTP fixture");
    const config = createPluginAppConfig(app);
    expect(
      isPluginAppConfig({ ...config, name: "Work", url: mcpAccountUrl(config.url, "work") }, app),
    ).toBe(true);
    expect(isPluginAppConfig({ ...config, name: "Work", url: config.url + "#other" }, app)).toBe(
      false,
    );
    expect(isPluginAppConfig({ ...config, url: "https://evil.example/mcp" }, app)).toBe(false);
    expect(isListingUrl("https://team.composio.dev/path", "https://composio.dev/")).toBe(true);
    expect(isListingUrl("https://composio.dev.evil.example/path", "https://composio.dev/")).toBe(
      false,
    );
    expect(isListingUrl("http://composio.dev/path", "https://composio.dev/")).toBe(false);
  });
  it("preserves credential bytes and merges only the fields supplied by the flow", () => {
    const app = MARKETPLACE_PLUGINS.flatMap((plugin) => plugin.apps).find(
      (app) => app.server.transport === "http",
    );
    if (!app) throw new Error("Missing fixture");
    const config = {
      ...createPluginAppConfig(app),
      headers: [
        { key: "X-Keep", value: "original" },
        { key: "Authorization", value: "old" },
      ],
    };
    const changed = applyMcpFlow(
      config,
      {
        id: "key",
        kind: "key",
        label: "Key",
        fields: [{ id: "token", label: "Token", header: "Authorization", prefix: "Bearer " }],
      },
      { token: " token " },
    );
    expect(changed.headers).toEqual([
      { key: "X-Keep", value: "original" },
      { key: "Authorization", value: "Bearer  token " },
    ]);
    expect(config.headers[1]?.value).toBe("old");
  });
});

import { relayCallbackQuery } from "./relay-callback";
it("sends only the source callback query and rejects the wrong sign-in state", () => {
  expect(relayCallbackQuery("openbot://callback?code=grant&state=mine#private", "mine")).toBe(
    "code=grant&state=mine",
  );
  expect(relayCallbackQuery("http://localhost:4411/callback?error=denied&state=mine", "mine")).toBe(
    "error=denied&state=mine",
  );
  expect(
    relayCallbackQuery("http://localhost:4411/callback?code=grant&state=theirs", "mine"),
  ).toBeNull();
  expect(relayCallbackQuery("https://service.example/", "mine")).toBeNull();
});
