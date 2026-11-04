import { expect, it } from "@effect/vitest";
import { hostedSiteLink, tableOwner, dataFailure } from "./data.ts";
const site = {
  id: "s",
  hostname: "example.openbot.site",
  url: "https://example.openbot.site/a",
  title: "A",
  description: "",
  framework: "astro" as const,
  status: "active" as const,
  fileCount: 0,
  size: 0,
  expiresAt: null,
  updatedAt: "",
  serverId: null,
};
it("opens only actual active HTTPS links without credentials or host mismatch", () => {
  expect(hostedSiteLink(site)).toBe(site.url);
  for (const url of [
    "javascript:alert(1)",
    "https://other.example/a",
    "https://user:secret@example.openbot.site/",
  ])
    expect(hostedSiteLink({ ...site, url })).toBeNull();
  expect(hostedSiteLink({ ...site, status: "blocked" })).toBeNull();
});
it("does not misattribute absent/deleted creators or treat failed reads as empty lists", () => {
  expect(tableOwner(null, [])).toBe("Created outside an agent");
  expect(tableOwner("gone", [])).toContain("Creator unavailable");
  expect(tableOwner("a", [{ id: "a", name: "Ada" }])).toBe("Created by Ada");
  expect(dataFailure({ dataError: "unsupported" })).toContain("does not support");
  expect(dataFailure({ dataError: "account-or-conflict" })).toContain("signed-in host account");
});
