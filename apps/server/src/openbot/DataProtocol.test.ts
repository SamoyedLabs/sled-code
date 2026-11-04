import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Data from "./DataProtocol.ts";
it("routes deletion only to fixed released paths with exact resource identity", () => {
  expect(Data.route({ operation: "tables.delete", name: "a/b" })).toEqual({
    method: "POST",
    path: "/v1/admin/shared-tables/delete",
    body: { name: "a/b" },
    dataProjection: "tables.delete",
  });
  expect(Data.route({ operation: "sites.list" }).path).toBe("/v1/hosted-sites/list");
  expect(Data.route({ operation: "sites.delete", siteId: "s" }).body).toEqual({ siteId: "s" });
  expect(Data.isRequest({ operation: "sites.publish" })).toBe(false);
});
it.effect("never projects rows, SQL or credentials and rejects malformed counts", () =>
  Effect.gen(function* () {
    const table = { name: "notes", ownerAgentId: null, rowCount: 0 };
    expect(
      yield* Data.project("tables.list", [{ ...table, rows: ["private"], sql: "private" }]),
    ).toEqual([table]);
    expect(
      (yield* Data.project("tables.list", [{ ...table, rowCount: -1 }]).pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(yield* Data.project("sites.delete", { credential: "private" })).toEqual({});
  }),
);
it.effect("retains hosted site status, quotas and ownership, discarding private extras", () =>
  Effect.gen(function* () {
    const site = {
      id: "s",
      hostname: "s.openbot.site",
      url: "https://s.openbot.site/",
      title: "Site",
      description: "Demo",
      framework: "vanilla",
      status: "blocked",
      fileCount: 1,
      size: 12,
      expiresAt: null,
      updatedAt: "2026-11-04",
      serverId: null,
    };
    expect(
      yield* Data.project("sites.list", {
        sites: [{ ...site, credential: "private" }],
        used: 1,
        limit: 0,
      }),
    ).toEqual({ sites: [site], used: 1, limit: 0 });
    expect(
      (yield* Data.project("sites.list", {
        sites: [{ ...site, status: "publishing" }],
        used: 1,
        limit: 2,
      }).pipe(Effect.result))._tag,
    ).toBe("Failure");
  }),
);
it.effect("service rejects malformed host responses with a safe typed failure", () =>
  Effect.gen(function* () {
    const service = yield* Data.Data;
    const result = yield* service.execute({ operation: "tables.list" }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("OpenbotDataError");
      expect(result.failure.message).not.toContain("private");
    }
  }).pipe(
    Effect.provide(Data.layer),
    Effect.provideService(
      Data.DataHost,
      Data.DataHost.of({ request: () => Effect.succeed({ secret: "private" }) }),
    ),
  ),
);
