import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { MarketplaceDraftDialog } from "./MarketplaceDraftDialog";

it("targets only a bot that has the skill and adds a draft without submitting a chat turn", async () => {
  const compose = vi.fn(() => true),
    close = vi.fn();
  await using _view = await render(
    <MarketplaceDraftDialog
      request={{
        title: "Try Review",
        text: "@[Review](skill:review) Help me use this skill.",
        agentIds: ["reviewer"],
      }}
      agents={[
        { id: "other", name: "Other" },
        { id: "reviewer", name: "Reviewer" },
      ]}
      activeAgentId="other"
      onCompose={compose}
      onClose={close}
    />,
  );
  await expect
    .element(page.getByRole("combobox", { name: "Draft bot" }))
    .toHaveTextContent("Reviewer");
  await page.getByRole("button", { name: "Add to draft", exact: true }).click();
  expect(compose).toHaveBeenCalledWith(
    "reviewer",
    "@[Review](skill:review) Help me use this skill.",
  );
  expect(close).toHaveBeenCalledOnce();
});
it("keeps a refused session change visible and refuses a removed destination", async () => {
  const compose = vi.fn(() => false),
    close = vi.fn();
  const request = { title: "Try an app", text: "Summarize my project" };
  const ui = (agents: readonly { id: string; name: string }[]) => (
    <MarketplaceDraftDialog request={request} agents={agents} onCompose={compose} onClose={close} />
  );
  await using view = await render(ui([{ id: "writer", name: "Writer" }]));
  await page.getByRole("button", { name: "Add to draft", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(
      "The selected host or session changed. Reopen the Marketplace before adding this draft.",
    );
  expect(close).not.toHaveBeenCalled();
  await view.rerender(ui([]));
  await expect
    .element(page.getByRole("button", { name: "Add to draft", exact: true }))
    .toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(compose).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
