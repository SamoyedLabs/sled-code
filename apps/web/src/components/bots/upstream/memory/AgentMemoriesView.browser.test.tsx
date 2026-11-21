/* oxlint-disable shadcn/no-unknown-classes -- Explicit source CSS imported for this real browser interaction test. */
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { AgentMemoriesView, type AgentMemoriesViewProps } from "./AgentMemoriesView";
import "~/index.css";
import "../openbot-tokens.css";
import "../openbot-react.css";
it("keeps an edited memory draft across a host refresh and clears search before leaving the panel", async () => {
  const update = vi.fn(async () => true),
    back = vi.fn();
  const memory = {
    id: "m",
    text: "Reports: Keep progress short.",
    origin: "manual" as const,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
  };
  const props: AgentMemoriesViewProps = {
    ownerNoun: "agent",
    ownerLabel: "Chief",
    memories: [memory],
    loading: false,
    error: null,
    reachedLimit: null,
    savingId: null,
    onBack: back,
    onClose: vi.fn(),
    onCreate: vi.fn(async () => true),
    onUpdate: update,
    onDelete: vi.fn(),
    onSetEveryChat: vi.fn(),
    onLetAgentDecide: vi.fn(),
    onClearAll: vi.fn(),
  };
  await using screen = await render(
    <div className="openbot-react">
      <AgentMemoriesView {...props} />
    </div>,
  );
  await screen.getByRole("searchbox", { name: "Search memories" }).fill("short reports");
  await expect.element(screen.getByRole("button", { name: "Reports", exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("searchbox")).toHaveValue("");
  expect(back).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Reports", exact: true }).click();
  await screen.getByRole("button", { name: "Edit", exact: true }).click();
  await screen.getByRole("textbox", { name: "Edit memory" }).fill("Reports: Use a weekly summary.");
  await screen.rerender(
    <div className="openbot-react">
      <AgentMemoriesView {...props} memories={[{ ...memory, updatedAt: "2026-01-03" }]} />
    </div>,
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Edit memory" }))
    .toHaveValue("Reports: Use a weekly summary.");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ id: "m" }),
    "Reports: Use a weekly summary.",
  );
  await screen.getByRole("button", { name: "Back to memories" }).click();
  await expect.element(screen.getByRole("button", { name: "Reports", exact: true })).toHaveFocus();
});
