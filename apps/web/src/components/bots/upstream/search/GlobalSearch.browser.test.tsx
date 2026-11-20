import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { GlobalSearch } from "./GlobalSearch";
import "~/index.css";
import "../openbot-react.css";
it("uses first Down as the first result and opens its exact agent identity", async () => {
  const select = vi.fn(),
    change = vi.fn();
  await using _screen = await render(
    <GlobalSearch
      open
      onOpenChange={change}
      agents={[
        { id: "first", name: "Alpine", provider: "codex" },
        { id: "second", name: "Beta", provider: "claude" },
      ]}
      onSelect={select}
    />,
  );
  await page.getByRole("combobox", { name: "Search OpenBot", exact: true }).fill("Alp");
  await expect
    .poll(() => {
      const row = document.querySelector<HTMLElement>(".global-search-result[data-first]");
      const highlight = document.querySelector<HTMLElement>(".global-search-highlight");
      if (!row || !highlight || highlight.hidden) return false;
      return Math.abs(row.getBoundingClientRect().top - highlight.getBoundingClientRect().top) < 2;
    })
    .toBe(true);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(select).toHaveBeenCalledWith({ kind: "agent", id: "first" });
  expect(change).toHaveBeenCalledWith(false);
});
it("opens remote message search hits with their original side-thread identity", async () => {
  const select = vi.fn();
  const search = vi.fn(async () => ({
    results: [
      {
        agentId: "agent",
        taskId: "side-thread",
        message: {
          id: "message",
          author: "agent",
          text: "needle in a side thread",
          createdAt: "2026-11-09T12:00:00Z",
        },
      },
    ],
    total: 1,
    nextCursor: null,
  }));
  await using _screen = await render(
    <GlobalSearch
      open
      onOpenChange={() => {}}
      agents={[{ id: "agent", name: "Alpine", provider: "codex" }]}
      onSearchMessages={search}
      onSelect={select}
    />,
  );
  await page.getByRole("combobox", { name: "Search OpenBot", exact: true }).fill("needle");
  await expect
    .element(page.getByRole("option").filter({ hasText: "needle in a side thread" }))
    .toBeVisible();
  await page.getByRole("option").filter({ hasText: "needle in a side thread" }).click();
  expect(search).toHaveBeenCalledWith("needle", undefined);
  expect(select).toHaveBeenCalledWith({
    kind: "message",
    agentId: "agent",
    taskId: "side-thread",
    messageId: "message",
  });
});
