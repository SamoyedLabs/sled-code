import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Catalog from "./CatalogProtocol.ts";
it.effect(
  "projects registry install identity and restart without exposing executable configuration",
  () =>
    Effect.gen(function* () {
      expect(
        yield* Catalog.project("registry.install", {
          agents: [
            {
              id: "demo",
              name: "Demo",
              command: "private",
              args: ["private"],
              envNames: ["TOKEN"],
              resolvedCommand: "/private",
            },
          ],
          restart: "skipped-busy",
          token: "private",
        }),
      ).toEqual({ agents: [{ id: "demo", name: "Demo" }], restart: "skipped-busy" });
      expect(
        (yield* Catalog.project("registry.status", [
          { registryId: "demo", state: "complete", message: null },
        ]).pipe(Effect.result))._tag,
      ).toBe("Failure");
    }),
);
it("keeps registry identity in bodies on the six fixed released routes", () => {
  const requests = [
    { operation: "registry.search", query: "a/b" },
    { operation: "registry.installed" },
    { operation: "registry.status" },
    {
      operation: "registry.install",
      registryId: "a/b",
      customAgentId: "demo",
      distribution: "uvx",
    },
    { operation: "registry.cancel", registryId: "a/b" },
    { operation: "registry.remove", registryId: "a/b" },
  ] as const;
  for (const request of requests)
    expect(Catalog.route(request).path).toBe(
      `/v1/admin/acp-registry/${request.operation.slice(9)}`,
    );
  expect(Catalog.route(requests[3]).body).toEqual({
    registryId: "a/b",
    customAgentId: "demo",
    distribution: "uvx",
  });
  expect(Catalog.isRequest({ operation: "registry.execute" })).toBe(false);
});
it.effect(
  "preserves catalog versions, distributions and in-progress state while rejecting malformed replies",
  () =>
    Effect.gen(function* () {
      const entry = {
        id: "demo",
        name: "Demo",
        version: "2",
        description: "Description",
        website: null,
        license: null,
        distributions: ["binary", "npx"],
        installedVersion: "1",
        customAgentId: "demo",
      };
      expect(yield* Catalog.project("registry.search", [{ ...entry, token: "private" }])).toEqual([
        entry,
      ]);
      expect(
        yield* Catalog.project("registry.status", [
          { registryId: "demo", state: "installing", message: null },
        ]),
      ).toEqual([{ registryId: "demo", state: "installing", message: null }]);
      expect(
        (yield* Catalog.project("registry.search", [{ ...entry, distributions: ["shell"] }]).pipe(
          Effect.result,
        ))._tag,
      ).toBe("Failure");
      expect(yield* Catalog.project("registry.remove", { token: "private" })).toEqual({});
    }),
);
