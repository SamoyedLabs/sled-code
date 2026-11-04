import { expect, it } from "vite-plus/test";
import {
  EMPTY_TEMPLATES,
  templateInstall,
  templateResult,
  templateStarted,
  templateFailed,
} from "./templates.ts";
const detail = {
  id: "template",
  creatorName: "Creator",
  name: "Agent",
  title: "Title",
  description: "Instructions",
  updatedAt: "revision-1",
  versionId: null,
  version: null,
  pending: false,
  skills: [],
  routines: [],
};
it("pins reviewed template revision, timezone and listing lineage; rejects invalid timezone and pending listings", () => {
  const state = templateResult(
    EMPTY_TEMPLATES,
    { operation: "templates.detail", templateId: "template" },
    detail,
  )!;
  expect(templateInstall(state, "America/Chicago", "receipt")).toEqual({
    operation: "templates.install",
    templateId: "template",
    expectedUpdatedAt: "revision-1",
    timezone: "America/Chicago",
  });
  expect(templateInstall(state, "Unknown/Timezone", "receipt")).toBeNull();
  expect(
    templateInstall(state, "UTC", "receipt", { agentId: "agent", listingId: "template" }),
  ).toBeNull();
  const market = { ...state, review: { kind: "marketplace" as const, detail } };
  expect(
    templateInstall(market, "UTC", "receipt", { agentId: "agent", listingId: "other" }),
  ).toBeNull();
  expect(
    templateInstall(
      { ...market, review: { kind: "marketplace", detail: { ...detail, pending: true } } },
      "UTC",
      "receipt",
    ),
  ).toBeNull();
});
it("retains exact receipt and revision on unknown outcomes and does not reconcile from a null preview", () => {
  const request = {
    operation: "templates.installMarketplace",
    listingId: "listing",
    receiptId: "original-receipt",
    timezone: "UTC",
  } as const;
  const failed = templateFailed(templateStarted(EMPTY_TEMPLATES, request), request);
  expect(failed.pending).toEqual(request);
  expect(
    templateInstall({ ...failed, review: { kind: "marketplace", detail } }, "UTC", "replacement"),
  ).toBeNull();
  const preview = { ...detail, agentId: "agent", publication: null, skillsError: null };
  const refreshed = templateResult(
    failed,
    { operation: "templates.preview", agentId: "agent" },
    preview,
  )!;
  expect(refreshed.uncertain).toBe(true);
  expect(refreshed.pending).toEqual(request);
  expect(refreshed.notice).toContain("unavailable");
  expect(
    templateResult(failed, { operation: "templates.preview", agentId: "other" }, preview),
  ).toBeNull();
});
it("refuses an update acknowledgement for a different destination agent", () => {
  const request = {
    operation: "templates.updateMarketplace",
    agentId: "original",
    listingId: "listing",
    timezone: "UTC",
  } as const;
  expect(
    templateResult(templateStarted(EMPTY_TEMPLATES, request), request, {
      agentId: "other",
      name: "Other",
    }),
  ).toBeNull();
});
