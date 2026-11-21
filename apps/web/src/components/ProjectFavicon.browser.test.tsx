import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { deriveProjectIdentity } from "../projectIdentity";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";

const state = vi.hoisted(() => ({ favicon: undefined as Atom.Atom<string | null> | undefined }));
vi.mock(import("../state/assets"), () => ({
  projectFaviconUrlAtom: () => {
    if (!state.favicon) throw new Error("Favicon resource not configured");
    return state.favicon;
  },
}));

function setup() {
  const activeResources = new Set<string>();
  state.favicon = Atom.make((get) => {
    activeResources.add("favicon");
    get.addFinalizer(() => activeResources.delete("favicon"));
    return null;
  });
  return { activeResources };
}

it("keeps custom icons and uses the displayed group identity for the automatic favicon", async () => {
  const { activeResources } = setup();
  const registry = AtomRegistry.make();
  const project: ProjectFaviconProject = {
    environmentId: EnvironmentId.make("test"),
    workspaceRoot: "/project",
    title: "Compose proof Beta",
    faviconPath: "icon.png",
    projectIcon: { kind: "monogram", text: "PR", color: "blue" },
  };
  const groupProject = { ...project, displayName: "SamoyedLabs/sled-code" };
  const expectedIdentity = deriveProjectIdentity(groupProject.displayName);
  const view = (
    projectIcon: ProjectFaviconProject["projectIcon"],
    displayName = groupProject.displayName,
  ) => (
    <RegistryContext value={registry}>
      <ProjectFavicon project={{ ...groupProject, displayName, projectIcon }} />
    </RegistryContext>
  );
  try {
    await using screen = await render(view(project.projectIcon));
    expect(activeResources.size).toBe(0);
    await expect.element(screen.getByText("PR", { exact: true })).toBeVisible();
    await screen.rerender(view({ kind: "emoji", emoji: "🌱" }));
    expect(activeResources.size).toBe(0);
    await screen.rerender(view({ kind: "lucide", name: "leaf", color: "green" }));
    expect(activeResources.size).toBe(0);
    await screen.rerender(view(null));
    expect(activeResources.size).toBe(1);
    await expect
      .element(screen.getByText(expectedIdentity.monogram, { exact: true }))
      .toBeVisible();
    await screen.rerender(view(null, project.title));
    await expect
      .element(screen.getByText(deriveProjectIdentity(project.title).monogram, { exact: true }))
      .toBeVisible();
    await screen.rerender(view(project.projectIcon));
    await expect.element(screen.getByText("PR", { exact: true })).toBeVisible();
    await screen.rerender(view(null));
    expect(activeResources.size).toBe(1);
  } finally {
    registry.dispose();
  }
});
