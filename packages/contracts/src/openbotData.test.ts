import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { OpenbotSharedTables, OpenbotHostedSites, OpenbotDataAdminRequest } from "./openbotData.ts";
const decodeTables = Schema.decodeUnknownSync(OpenbotSharedTables);
const decodeSites = Schema.decodeUnknownSync(OpenbotHostedSites);
const decodeAdmin = Schema.decodeUnknownSync(OpenbotDataAdminRequest);
it("preserves nullable table ownership/counts and strips rows", () => {
  expect(
    decodeTables([{ name: "notes", ownerAgentId: null, rowCount: null, rows: ["private"] }]),
  ).toEqual([{ name: "notes", ownerAgentId: null, rowCount: null }]);
  expect(() =>
    decodeTables([{ name: "n", ownerAgentId: null, rowCount: Number.MAX_SAFE_INTEGER + 1 }]),
  ).toThrow();
});
it("rejects invented publish/SQL operations and unsafe wire identifiers", () => {
  for (const request of [
    { operation: "sites.publish" },
    { operation: "tables.sql", sql: "select 1" },
    { operation: "sites.delete", siteId: "" },
  ])
    expect(() => decodeAdmin(request)).toThrow();
});
it("retains zero quotas and released site states while bounding lists", () => {
  expect(decodeSites({ sites: [], used: 0, limit: 0 })).toEqual({
    sites: [],
    used: 0,
    limit: 0,
  });
  expect(() => decodeSites({ sites: [], used: -1, limit: 0 })).toThrow();
});
