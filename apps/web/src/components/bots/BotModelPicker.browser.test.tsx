import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotModelPicker } from "./BotModelPicker";
import { ComposerSurface } from "../chat/ComposerSurface";
import type { AgentStatus, ClientAgentModelOption } from "./upstream/provider/types";
import "~/index.css";

it.each([
  { height: 720, top: 80 },
  { height: 540, top: 380 },
  { height: 400, top: 190 },
])(
  "keeps the picker outside the composer at y=$top in a $height px window",
  async ({ height, top }) => {
    await page.viewport(1100, height);
    const change = vi.fn();
    await using screen = await render(
      <div style={{ position: "fixed", top, left: 280, width: 700 }}>
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <ComposerSurface.Main>
              <textarea aria-label="Draft placement check" style={{ height: 80, width: "100%" }} />
              <ComposerSurface.Footer>
                <div className="ms-auto">
                  <BotModelPicker
                    scope="placement"
                    provider="codex"
                    value="luna"
                    modelOptions={models}
                    agentStatus={status}
                    accountChoice
                    onChange={change}
                  />
                </div>
              </ComposerSurface.Footer>
            </ComposerSurface.Main>
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
      </div>,
    );
    const composer = screen.container.querySelector('[data-slot="composer-shell"]')!;
    await screen.getByRole("button", { name: /Choose bot model/ }).click();
    await expect.element(page.getByPlaceholder("Search models...")).toBeVisible();
    await vi.waitFor(() => {
      const card = composer.getBoundingClientRect();
      const popup = document.querySelector('[data-slot="popover-popup"]')!.getBoundingClientRect();
      expect(popup.height).toBeGreaterThan(100);
      expect(popup.bottom <= card.top - 3 || popup.top >= card.bottom + 3).toBe(true);
      expect(popup.top).toBeGreaterThanOrEqual(0);
      expect(popup.bottom).toBeLessThanOrEqual(height);
      expect(popup.right).toBeLessThanOrEqual(card.right + 1);
    });
    expect(change).not.toHaveBeenCalled();
  },
);

const models: ClientAgentModelOption[] = [
  {
    provider: "codex",
    id: "luna",
    name: "Luna",
    description: "",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "high"],
  },
  {
    provider: "codex",
    id: "next",
    name: "Next model",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
];
const status: AgentStatus = {
  phase: "ready",
  providers: [
    {
      id: "codex",
      state: "available",
      version: null,
      message: null,
      accounts: [
        { id: "default", label: "Personal", email: null, state: "connected", message: null },
        { id: "work-exact-id", label: "Work", email: null, state: "connected", message: null },
      ],
    },
  ],
};

it("uses Threads model/effort controls while preserving the exact bot account and supported effort", async () => {
  const change = vi.fn(),
    effort = vi.fn();
  await using screen = await render(
    <BotModelPicker
      scope="host"
      provider="codex"
      value="luna"
      modelOptions={models}
      agentStatus={status}
      accountChoice
      reasoningEffort="high"
      onReasoningEffortChange={effort}
      onChange={change}
    />,
  );
  await screen.getByRole("button", { name: /Choose bot model/ }).click();
  await page.getByRole("radio", { name: /Low/ }).click();
  expect(effort).toHaveBeenCalledWith("low");
  expect(change).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "ChatGPT · Work", exact: true }).click();
  await page.getByRole("option", { name: /Next model/ }).click();
  expect(change).toHaveBeenCalledExactlyOnceWith("next", "codex", "work-exact-id", "medium");
  await page.getByRole("button", { name: "ChatGPT · Personal", exact: true }).click();
  await page.getByRole("option", { name: /Luna/ }).click();
  expect(change).toHaveBeenLastCalledWith("luna", "codex", null, "high");
});

it("does not offer disconnected accounts as selectable bot models", async () => {
  const change = vi.fn();
  const disconnected: AgentStatus = {
    ...status,
    providers: status.providers?.map((provider) => ({
      ...provider,
      accounts: provider.accounts?.map((account) =>
        account.id === "default" ? account : { ...account, state: "disconnected" },
      ),
    })),
  };
  await using screen = await render(
    <BotModelPicker
      scope="host"
      provider="codex"
      value="luna"
      modelOptions={models}
      agentStatus={disconnected}
      accountChoice
      onChange={change}
    />,
  );
  await screen.getByRole("button", { name: /Choose bot model/ }).click();
  await expect.element(page.getByRole("button", { name: /ChatGPT · Work/ })).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});
