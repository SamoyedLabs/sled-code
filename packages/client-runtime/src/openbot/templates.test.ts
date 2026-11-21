import { expect, it } from "vite-plus/test";
import {
  EMPTY_TEMPLATES,
  decodeTemplateAgents,
  templateInstall,
  templateResult,
  templateStarted,
  templateFailed,
} from "./templates.ts";

it("keeps the full destination roster when one agent uses the OpenBot marketplace source shape", () => {
  expect(
    decodeTemplateAgents([
      { id: "local", name: "Local agent" },
      {
        id: "installed",
        name: "Installed agent",
        marketplaceSource: { agentId: "catalog-agent", versionId: "version", skillIds: [] },
      },
      { id: "legacy", name: "Legacy agent", marketplaceSource: { listingId: "legacy-listing" } },
    ]),
  ).toEqual([
    { id: "local", name: "Local agent" },
    { id: "installed", name: "Installed agent", listingId: "catalog-agent" },
    { id: "legacy", name: "Legacy agent", listingId: "legacy-listing" },
  ]);
});

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
it("pins real host creation identity and reviewed marketplace version, then recovers the original result from durable history", async () => {
  const { templateFeatures } = await import("./templates.ts");
  expect(templateFeatures({ capabilities: ["agent-review-v1"] })).toEqual({
    reviewAvailable: true,
    adoptionAvailable: false,
  });
  expect(
    templateFeatures({ capabilities: ["agent-review-v1", "agent-adoption-v1"] }).adoptionAvailable,
  ).toBe(true);
  const state = {
    ...EMPTY_TEMPLATES,
    review: { kind: "marketplace" as const, detail: { ...detail, versionId: "version-2" } },
  };
  const request = templateInstall(state, "UTC", "original-identity", undefined, true)!;
  expect(request).toEqual({
    operation: "templates.adopt",
    operationId: "original-identity",
    kind: "marketplace",
    sourceId: "template",
    timezone: "UTC",
    expectedRevision: "version-2",
  });
  const failed = templateFailed(templateStarted(state, request), request);
  const result = {
    operationId: "original-identity",
    kind: "marketplace",
    sourceId: "template",
    state: "complete",
    agentId: "actual-agent",
    name: "Actual",
  };
  expect(templateResult(failed, { operation: "templates.adoptions" }, [result])?.uncertain).toBe(
    false,
  );
  expect(
    templateResult(
      failed,
      { operation: "templates.adoptionStatus", operationId: "different" },
      result,
    ),
  ).toBeNull();
  const interrupted = templateResult(failed, { operation: "templates.adoptions" }, [
    { ...result, state: "interrupted" },
  ])!;
  expect(interrupted.uncertain).toBe(true);
  expect(interrupted.notice).toContain("retained");
});

it("journals marketplace updates with the reviewed version and original target, and rejects mismatched history", () => {
  const state = {
    ...EMPTY_TEMPLATES,
    review: { kind: "marketplace" as const, detail: { ...detail, versionId: "version-2" } },
  };
  const request = templateInstall(
    state,
    "UTC",
    "update-identity",
    { agentId: "installed", listingId: "template" },
    true,
  )!;
  expect(request).toEqual({
    operation: "templates.adopt",
    operationId: "update-identity",
    kind: "marketplace",
    sourceId: "template",
    timezone: "UTC",
    expectedRevision: "version-2",
    agentId: "installed",
  });
  const pending = templateStarted(state, request);
  const receipt = {
    operationId: "update-identity",
    kind: "marketplace",
    sourceId: "other",
    state: "complete",
    agentId: "installed",
    name: "Installed",
  };
  expect(templateResult(pending, { operation: "templates.adoptions" }, [receipt])).toBeNull();
  expect(
    templateResult(pending, { operation: "templates.adoptions" }, [
      { ...receipt, sourceId: "template", agentId: "another-agent" },
    ]),
  ).toBeNull();
});
it("does not turn a missing operation status or an incomplete receipt into success", () => {
  const request = { operation: "templates.adoptionStatus", operationId: "missing" } as const;
  expect(templateResult(EMPTY_TEMPLATES, request, null)?.notice).toContain("not found");
  expect(
    templateResult(EMPTY_TEMPLATES, request, {
      operationId: "missing",
      kind: "template",
      sourceId: "source",
      state: "complete",
      agentId: null,
      name: null,
    }),
  ).toBeNull();
});
