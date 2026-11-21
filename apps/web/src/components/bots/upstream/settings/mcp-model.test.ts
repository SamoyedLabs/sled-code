import { expect, it } from "vite-plus/test";
import {
  emptyMcpConfig,
  mcpConfigChanged,
  mcpConfigErrors,
  mcpSaveConnects,
  normalizeMcpConfig,
} from "./mcp-model";
it("preserves credential and argument spaces while dropping blank rows and the inactive transport", () => {
  const config = {
    ...emptyMcpConfig(),
    name: " Example ",
    command: " node ",
    args: ["file with space ", " "],
    env: [
      { key: " TOKEN ", value: " secret " },
      { key: " ", value: "ignored" },
    ],
    url: "https://unused.example",
    headers: [{ key: "Authorization", value: "unused" }],
  };
  expect(normalizeMcpConfig(config)).toMatchObject({
    name: "Example",
    command: "node",
    args: ["file with space "],
    env: [{ key: "TOKEN", value: " secret " }],
    url: "",
    headers: [],
  });
  expect(mcpConfigChanged({ ...config, env: [{ key: "TOKEN", value: "secret" }] }, config)).toBe(
    true,
  );
});
it("connects a changed HTTP endpoint before saving, while a rename preserves its existing sign-in", () => {
  const saved = {
    ...emptyMcpConfig(),
    id: "mcp-one",
    name: "Example",
    transport: "http" as const,
    url: "https://example.com/mcp",
    headers: [{ key: "Authorization", value: "token" }],
  };
  expect(mcpSaveConnects({ ...saved, name: "Renamed" }, saved, false)).toBe(false);
  expect(
    mcpSaveConnects(
      { ...saved, headers: [{ key: "Authorization", value: "token " }] },
      saved,
      false,
    ),
  ).toBe(true);
  expect(mcpConfigErrors({ ...saved, name: "computer_use" })).toHaveProperty("name");
  expect(mcpConfigErrors({ ...saved, url: "file:///tmp/config" })).toHaveProperty("url");
});
