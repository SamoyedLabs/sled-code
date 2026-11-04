import { expect, it } from "@effect/vitest";
import { catalogRequiredScopes } from "./openbotCatalog.ts";
it("requires settings and provider authority for every registry command on its exact read or admin port", () => {
  for (const operation of ["registry.search", "registry.status", "registry.installed"]) {
    expect(catalogRequiredScopes(operation, "read")).toEqual([
      "settings:write",
      "providers:manage",
    ]);
    expect(catalogRequiredScopes(operation, "admin")).toBeNull();
  }
  for (const operation of ["registry.install", "registry.cancel", "registry.remove"]) {
    expect(catalogRequiredScopes(operation, "admin")).toEqual([
      "settings:write",
      "providers:manage",
    ]);
    expect(catalogRequiredScopes(operation, "read")).toBeNull();
  }
  for (const operation of ["registry.execute", "registry.any-path", null])
    expect(catalogRequiredScopes(operation, "admin")).toBeNull();
});
