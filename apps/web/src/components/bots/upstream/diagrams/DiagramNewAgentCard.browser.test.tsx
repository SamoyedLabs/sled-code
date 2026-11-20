import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../../../test/render";
import { DiagramNewAgentCard } from "./DiagramNewAgentCard";
vi.mock("../../../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null }),
}));
vi.mock("../../SourceProviderEnvironment", () => ({ useSourceProviderData: () => null }));
it("keeps focus and typed name/purpose as the guarded creation state re-renders", async () => {
  await using screen = await render(
    <DiagramNewAgentCard
      environmentId={EnvironmentId.make("remote")}
      hostId="host"
      at={{ x: 20, y: 20 }}
      onCreate={async () => {}}
      onCancel={() => {}}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Agent name" }),
    purpose = screen.getByRole("textbox", { name: "What the agent does" });
  await name.click();
  await userEvent.keyboard("Canvas check");
  await purpose.click();
  await userEvent.keyboard("Tiny routine helper");
  await expect.element(purpose).toHaveValue("Tiny routine helper");
  await expect.element(purpose).toHaveFocus();
  await expect.element(name).toHaveValue("Canvas check");
});
