import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { UnifiedUsagePage } from "./UnifiedUsagePage";
import "~/index.css";

vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("primary"),
  useEnvironments: () => ({
    environments: [
      { environmentId: EnvironmentId.make("primary"), label: "Primary" },
      { environmentId: EnvironmentId.make("remote"), label: "Remote" },
    ],
  }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { state: "ready", hostId: "bot-host" } }),
}));
vi.mock("../bots/SourceProviderEnvironment", () => ({
  SourceProviderHost: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../bots/ReactBotUsage", () => ({
  ReactBotUsage: ({ environmentId, hostId }: { environmentId: string; hostId: string }) => (
    <p>
      Bot report: {environmentId}/{hostId}
    </p>
  ),
}));
vi.mock("./UsagePage", () => ({
  UsagePage: ({ embedded, surface }: { embedded: boolean; surface: string }) => (
    <p>
      Provider report: {surface}/{String(embedded)}
    </p>
  ),
}));

it("joins remote bot analytics, thread diagnostics and limits in one dismissible usage window", async () => {
  await using screen = await render(<UnifiedUsagePage />, {
    router: "/usage?view=bots&machine=remote",
  });
  await expect.element(screen.getByText("Bot report: remote/bot-host")).toBeVisible();
  await screen.getByRole("button", { name: "Threads", exact: true }).click();
  await expect.element(screen.getByText("Provider report: threads/true")).toBeVisible();
  await screen.getByRole("button", { name: "Limits", exact: true }).click();
  await expect.element(screen.getByText("Provider report: limits/true")).toBeVisible();
  await screen.getByRole("button", { name: "Bots", exact: true }).click();
  await expect.element(screen.getByText("Bot report: remote/bot-host")).toBeVisible();
  expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
});
