import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { WorkspaceViewSwitcher } from "./WorkspaceModeHeader";
import "~/index.css";

it("keeps the active pill mounted when a switch is reversed mid-transition", async () => {
  const onBots = vi.fn(),
    onThreads = vi.fn();
  const ui = (bots: boolean) => (
    <div style={{ width: 300 }}>
      <WorkspaceViewSwitcher bots={bots} onBots={onBots} onThreads={onThreads} />
    </div>
  );
  await using screen = await render(ui(true));
  const pill = screen.container.querySelector(".workspace-view-indicator");
  await screen.getByRole("button", { name: "Threads", exact: true }).click();
  expect(onThreads).toHaveBeenCalledOnce();
  await screen.rerender(ui(false));
  expect(screen.container.querySelector(".workspace-view-indicator")).toBe(pill);
  await screen.getByRole("button", { name: "Bots", exact: true }).click();
  expect(onBots).toHaveBeenCalledOnce();
  await screen.rerender(ui(true));
  expect(screen.container.querySelector(".workspace-view-indicator")).toBe(pill);
  expect(
    screen
      .getByRole("button", { name: "Bots", exact: true })
      .element()
      .getAttribute("aria-current"),
  ).toBe("page");
});
