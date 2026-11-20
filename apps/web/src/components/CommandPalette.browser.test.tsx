import "~/index.css";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import { CommandPalette } from "./CommandPalette";

const entities = vi.hoisted(() => ({
  projects: [] as ReadonlyArray<Project>,
  threads: [] as ReadonlyArray<Thread>,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => entities.projects,
  useVisibleThreadShells: () => entities.threads,
}));

function setup(state: { projects?: ReadonlyArray<Project>; threads?: ReadonlyArray<Thread> } = {}) {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  entities.projects = state.projects ?? [];
  entities.threads = state.threads ?? [];
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    const environmentId = EnvironmentId.make("local");
    setup({
      projects: ["Acme", "Workshop"].map((title) => ({
        id: ProjectId.make(title.toLowerCase()),
        environmentId,
        title,
        workspaceRoot: `/work/${title.toLowerCase()}`,
        repositoryIdentity: null,
        defaultModelSelection: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        scripts: [],
      })),
    });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
    await expect.element(page.getByRole("option", { name: /Acme/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Workshop/ })).toBeVisible();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search threads, projects, and commands...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("opens Bots in its own scope and offers the two compose destinations", async () => {
    setup();
    await using screen = await render(<CommandPalette>{null}</CommandPalette>, { router: "/bots" });
    openCommandPalette();
    await expect
      .element(page.getByRole("button", { name: "Bots", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("option", { name: "New bot", exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /New thread/ })).not.toBeInTheDocument();
    openCommandPalette({ open: "new-bot-chat" });
    await expect
      .element(page.getByRole("option", { name: "New group chat", exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("option", { name: "New bot", exact: true })).toBeVisible();
    await expect
      .poll(() => screen.container.ownerDocument.querySelectorAll('[role="option"]').length)
      .toBe(2);
  });

  it("opens a searched project's latest listed thread, not a newer subagent", async () => {
    const environmentId = EnvironmentId.make("local");
    const projectId = ProjectId.make("acme");
    const parentId = ThreadId.make("parent");
    setup({
      projects: [
        {
          id: projectId,
          environmentId,
          title: "Acme",
          workspaceRoot: "/work/acme",
          repositoryIdentity: null,
          defaultModelSelection: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          scripts: [],
        },
      ],
      threads: [
        makeThreadFixture({
          id: parentId,
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-02T00:00:00.000Z",
        }),
        makeThreadFixture({
          id: ThreadId.make("subagent"),
          environmentId,
          projectId,
          updatedAt: "2026-03-03T00:00:00.000Z",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
      ],
    });
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "Acme" });
    await page.getByRole("option", { name: /Acme/ }).first().click();

    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/parent"));
  });
});

describe("Unified workspace commands", () => {
  it("filters Bots and Commands without leaking unrelated project actions", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette();
    await page.getByRole("button", { name: "Bots", exact: true }).click();
    await expect.element(page.getByRole("option", { name: "New bot", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: "Open settings", exact: true }))
      .not.toBeInTheDocument();
    const input = page.getByPlaceholder("Search bots, messages, and commands...");
    await input.fill("project");
    await expect
      .element(page.getByRole("option", { name: "Add project...", exact: true }))
      .not.toBeInTheDocument();
    await input.fill("");
    await page.getByRole("button", { name: "Commands", exact: true }).click();
    await expect
      .element(page.getByRole("option", { name: "Open settings", exact: true }))
      .toBeVisible();
  });
  it("opens a Bots control through the same global palette used for Threads", async () => {
    setup();
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette();
    await page.getByRole("button", { name: "Bots", exact: true }).click();
    await page.getByRole("combobox").fill("Bot tasks");
    await page.getByRole("option", { name: "Bot tasks", exact: true }).click();
    await vi.waitFor(() => {
      expect(screen.router?.state.location.pathname).toBe("/bots");
      expect(screen.router?.state.location.search).toMatchObject({ botPage: "tasks" });
    });
  });
});
