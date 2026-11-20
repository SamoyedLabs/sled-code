import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { WorkspaceRailUsage } from "./WorkspaceRailUsage";
import "~/index.css";
import "../workspace-mode.css";
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("local"),
  useEnvironments: () => ({
    environments: [
      { environmentId: EnvironmentId.make("local") },
      { environmentId: EnvironmentId.make("remote") },
    ],
  }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { state: "ready", hostId: "host" } }),
}));
vi.mock("./upstream/provider/useOpenbotProviderData", () => ({
  useOpenbotProviderData: () => ({
    usage: {
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 85, windowDurationMins: 10080, resetsAt: null },
        },
      ],
    },
    status: { providers: [{ id: "codex", state: "ready", version: null, message: null }] },
  }),
}));
it("uses the real provider quota ring and opens analytics for its selected remote host", async () => {
  await using screen = await render(<WorkspaceRailUsage />, { router: "/bots?machine=remote" });
  const ring = screen.getByRole("button", { name: /ChatGPT usage.*15% remaining/ });
  await expect.element(ring).toBeVisible();
  expect(
    screen.container.querySelector(".window-rail-usage-arc")?.getAttribute("stroke-dasharray"),
  ).toBe("15 100");
  expect(screen.container.querySelector(".workspace-rail-usage-fallback")).toBeNull();
  await ring.click();
  expect(screen.router?.state.location.pathname).toBe("/usage");
  expect(screen.router?.state.location.search).toMatchObject({ machine: "remote", view: "bots" });
});
