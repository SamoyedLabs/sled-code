import { expect, it } from "@effect/vitest";
import { EMPTY_CATALOG, catalogResult, catalogRecovered, registryInstall } from "./catalog.ts";
it("pins updates to the original provider identity and offered distribution", () => {
  const entry = { id: "upstream", customAgentId: "original", distributions: ["binary"] };
  expect(registryInstall(entry, "replacement", "npx", "Name")).toBeNull();
  expect(registryInstall(entry, "replacement", "binary", "Name")).toEqual({
    operation: "registry.install",
    registryId: "upstream",
    customAgentId: "original",
    distribution: "binary",
    name: "Name",
  });
  expect(registryInstall({ ...entry, customAgentId: null }, "codex", "binary", "")).toBeNull();
});
it("requires installed and terminal status snapshots to reconcile accepted or uncertain mutations", () => {
  const request = {
    operation: "registry.install",
    registryId: "upstream",
    customAgentId: "original",
  } as const;
  const before = { ...EMPTY_CATALOG, installed: [], status: [] };
  const accepted = catalogResult(before, request, { agents: [], restart: "skipped-busy" });
  expect(accepted?.notice).toContain("skipped");
  expect(accepted && catalogRecovered(accepted)).toBe(false);
  const installing = {
    ...EMPTY_CATALOG,
    installed: [],
    status: [{ registryId: "upstream", state: "installing" as const, message: null }],
  };
  expect(catalogRecovered(installing)).toBe(false);
  expect(catalogRecovered({ ...installing, status: [] })).toBe(true);
  expect(catalogResult(before, request, { accepted: true })).toBeNull();
});
