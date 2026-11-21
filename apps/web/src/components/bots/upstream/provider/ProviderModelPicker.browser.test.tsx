/* oxlint-disable shadcn/no-unknown-classes -- Scoped source styles are explicitly imported. */
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { OpenbotProviderModelPicker } from "./ProviderModelPicker";
import type { ClientAgentModelOption } from "./types";
import "~/index.css";
import "../openbot-tokens.css";
import "../openbot-react.css";
const models: ClientAgentModelOption[] = [
  {
    provider: "codex",
    id: "current",
    name: "Current model",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    fastServiceTier: "priority",
  },
  {
    provider: "claude",
    id: "next",
    name: "Next model",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "claude",
    id: "older",
    name: "Legacy model",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    listing: "older",
  },
];
it("queues effort on another account's provider tab, applies it with the model, and searches folded models", async () => {
  const onChange = vi.fn();
  const onEffort = vi.fn();
  await using screen = await render(
    <div className="openbot-react">
      <OpenbotProviderModelPicker
        provider="codex"
        value="current"
        reasoningEffort="medium"
        onReasoningEffortChange={onEffort}
        modelOptions={models}
        agentStatus={{
          phase: "ready",
          providers: [
            { id: "codex", state: "available", version: null, message: null },
            {
              id: "claude",
              state: "available",
              version: null,
              message: null,
              accounts: [
                {
                  id: "default",
                  label: "Personal",
                  email: null,
                  state: "connected",
                  message: null,
                },
                {
                  id: "a1111111111111111",
                  label: "Work",
                  email: null,
                  state: "connected",
                  message: null,
                },
              ],
            },
          ],
        }}
        accountChoice
        onChange={onChange}
      />
    </div>,
  );
  await screen.getByRole("button", { name: "Current model · Medium", exact: true }).click();
  await page.getByRole("tab", { name: "Claude · Work", exact: true }).click();
  await page.getByRole("combobox", { name: "Agent reasoning effort", exact: true }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  expect(onEffort).not.toHaveBeenCalled();
  await page.getByRole("option", { name: "Next model", exact: true }).click();
  expect(onChange).toHaveBeenCalledWith("next", "claude", "a1111111111111111", "high");
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("Legacy");
  await expect
    .element(page.getByRole("option", { name: "Legacy model", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
it("does not enable a signed-out extra account or invent a fast switch for a standard model", async () => {
  await using screen = await render(
    <div className="openbot-react">
      <OpenbotProviderModelPicker
        provider="claude"
        value="next"
        providerAccountId="a1111111111111111"
        modelOptions={models}
        fastMode
        onFastModeChange={() => undefined}
        accountChoice
        agentStatus={{
          phase: "ready",
          providers: [
            {
              id: "claude",
              state: "available",
              version: null,
              message: null,
              accounts: [
                {
                  id: "default",
                  label: "Personal",
                  email: null,
                  state: "connected",
                  message: null,
                },
                {
                  id: "a1111111111111111",
                  label: "Work",
                  email: null,
                  state: "signed-out",
                  message: "Sign in again",
                },
              ],
            },
          ],
        }}
        onChange={() => undefined}
      />
    </div>,
  );
  await screen.getByRole("button", { name: "Next model · Work", exact: true }).click();
  await expect
    .element(page.getByRole("option", { name: "Next model", exact: true }))
    .toBeDisabled();
  await expect.element(page.getByRole("switch")).not.toBeInTheDocument();
});
