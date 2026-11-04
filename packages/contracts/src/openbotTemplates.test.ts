import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { templateRequiredScopes, TemplatePublication } from "./openbotTemplates.ts";
const isPublication = Schema.is(TemplatePublication);
it("requires exact provider/settings authority and operate authority for mutations on their correct port", () => {
  for (const operation of ["templates.preview", "templates.detail", "templates.listing"]) {
    expect(templateRequiredScopes(operation, "read")).toEqual([
      "settings:write",
      "providers:manage",
    ]);
    expect(templateRequiredScopes(operation, "admin")).toBeNull();
  }
  for (const operation of [
    "templates.install",
    "templates.installMarketplace",
    "templates.updateMarketplace",
    "templates.publish",
    "templates.unpublish",
  ]) {
    expect(templateRequiredScopes(operation, "admin")).toEqual([
      "settings:write",
      "providers:manage",
      "orchestration:operate",
    ]);
    expect(templateRequiredScopes(operation, "read")).toBeNull();
  }
  expect(templateRequiredScopes("templates.execute", "admin")).toBeNull();
});

it("accepts only source-backed publication links matching the reported template identity", () => {
  const publication = {
    templateId: "abcdefghijklmnopqrstuv",
    shareUrl: "https://openbot.run/agents/abcdefghijklmnopqrstuv",
    publishedAt: "revision",
  };
  expect(isPublication(publication)).toBe(true);
  for (const shareUrl of [
    "https://attacker.invalid/agents/abcdefghijklmnopqrstuv",
    "https://openbot.run/agents/abcdefghijklmnopqrstuv?token=private",
    "https://openbot.run/agents/vutsrqponmlkjihgfedcba",
  ]) {
    expect(isPublication({ ...publication, shareUrl })).toBe(false);
  }
});
