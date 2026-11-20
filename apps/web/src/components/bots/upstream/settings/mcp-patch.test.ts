import { describe, it, expect } from "vite-plus/test";
import { emptyMcpConfig, mcpSaveConnects, type McpServerConfig } from "./mcp-model";
import { retainedMcpPatch } from "./mcp-patch";
const baseline: McpServerConfig = {
  ...emptyMcpConfig(),
  id: "saved",
  name: "Original",
  transport: "stdio",
  command: "node",
  args: [],
  env: [],
  headers: [],
  envPassthrough: ["HOME"],
  retained: { args: 2, env: ["TOKEN"], headers: [] },
};
describe("source MCP opaque fields", () => {
  it("renames without replacing retained arguments or credentials", () => {
    expect(retainedMcpPatch({ ...baseline, name: "Renamed" }, baseline)).toEqual({
      name: "Renamed",
    });
  });
  it("distinguishes explicit clearing from untouched hidden fields", () => {
    expect(
      retainedMcpPatch(
        { ...baseline, args: [], retained: { env: ["TOKEN"], headers: [] } },
        baseline,
      ),
    ).toEqual({ args: [] });
  });
  it("preserves replacement credential and argument whitespace", () => {
    expect(
      retainedMcpPatch(
        {
          ...baseline,
          args: ["token "],
          env: [{ key: "TOKEN", value: " secret " }],
          retained: { headers: [] },
        },
        baseline,
      ),
    ).toEqual({ args: ["token "], env: [{ key: "TOKEN", value: " secret " }] });
  });
});

it("retests HTTP after explicitly clearing opaque saved headers", () => {
  const saved: McpServerConfig = {
    ...baseline,
    transport: "http",
    url: "https://example.com/mcp",
    retained: { headers: ["Authorization"] },
  };
  expect(mcpSaveConnects({ ...saved, headers: [], retained: {} }, saved, false)).toBe(true);
  expect(mcpSaveConnects({ ...saved, name: "Renamed" }, saved, false)).toBe(false);
});
