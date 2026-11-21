import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { render } from "../../../../../test/render";
import { MarketplaceDetail } from "./MarketplaceDetail";
import type { MarketplaceProps, AgentSummary } from "./marketplace-model";

it("finishes the initial public listing review and history read before offering durable adoption", async () => {
  const registry = AtomRegistry.make();
  const calls: string[] = [];
  const listing: AgentSummary = {
    id: "public-reviewer",
    name: "Change Reviewer",
    title: "Review changes",
    description: "A focused public agent",
    creatorName: "OpenBot",
    version: 4,
    installs: 0,
    featured: true,
    updatedAt: "2026-11-15T12:00:00Z",
    verified: false,
    category: "coding",
    avatarSeed: "public-reviewer",
    avatarHue: 215,
    skillCount: 1,
    routineCount: 0,
    activeRoutineCount: 0,
  };
  const model: MarketplaceProps = {
    scopeKey: "public-catalog-review-regression",
    capabilities: ["sled-public-catalog-v1", "agent-review-v1", "agent-adoption-v1"],
    agents: [],
    actions: { can: () => false, execute: async () => null },
    templates: {
      can: () => true,
      execute: async (request) => {
        calls.push(request.operation);
        if (request.operation === "templates.adoptions") return [];
        if (request.operation === "templates.listing")
          return {
            id: listing.id,
            name: listing.name,
            title: listing.title,
            description: listing.description,
            creatorName: listing.creatorName,
            updatedAt: listing.updatedAt,
            version: 4,
            versionId: "public-version-4",
            pending: false,
            routines: [],
            skills: [
              {
                kind: "marketplace",
                skillId: "review",
                versionId: "review-4",
                slug: "review",
                name: "Review skill",
                version: 4,
              },
            ],
          };
        throw new Error("Unexpected mutation during review");
      },
    },
  };
  await using view = await render(
    <RegistryContext.Provider value={registry}>
      <MarketplaceDetail
        listing={{ kind: "agent", value: listing }}
        model={model}
        installed={{}}
        refreshSkills={async () => {}}
      />
    </RegistryContext.Provider>,
  );
  await expect.element(view.getByRole("button", { name: "Add agent", exact: true })).toBeEnabled();
  await expect.element(view.getByText("Review skill", { exact: true })).toBeVisible();
  await expect.element(view.getByText("Public OpenBot catalog", { exact: true })).toBeVisible();
  expect(calls).toEqual(["templates.listing", "templates.adoptions"]);
  await view.rerender(
    <RegistryContext.Provider value={registry}>
      <MarketplaceDetail
        listing={{ kind: "agent", value: listing }}
        model={{
          ...model,
          agents: [{ id: "installed-agent", name: listing.name, listingId: listing.id }],
          onOpenAgent: () => {},
        }}
        installed={{}}
        refreshSkills={async () => {}}
      />
    </RegistryContext.Provider>,
  );
  await expect.element(view.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
  await expect.element(view.getByRole("button", { name: "Open chat", exact: true })).toBeVisible();
  await expect
    .element(view.getByRole("button", { name: "Add agent", exact: true }))
    .not.toBeInTheDocument();

  await expect.element(view.getByText(/Made by another OpenBot user/)).not.toBeInTheDocument();
});
