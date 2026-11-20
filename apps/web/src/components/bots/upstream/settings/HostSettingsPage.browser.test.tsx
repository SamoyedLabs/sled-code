import { expect, it } from "vite-plus/test";
import { render } from "../../../../../test/render";
import { HostSettingsPage } from "./HostSettingsPage";
it("embeds only the selected host panel without a second settings navigation", async () => {
  const panels = {
    general: <button>Rename host</button>,
    providers: <button>Manage models</button>,
    vault: <button>Open Vault</button>,
  };
  await using screen = await render(
    <HostSettingsPage panels={panels} embeddedSection="providers" />,
  );
  await expect.element(screen.getByRole("button", { name: "Manage models" })).toBeVisible();
  await expect.element(screen.getByRole("navigation")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Rename host" })).not.toBeInTheDocument();
  await screen.rerender(<HostSettingsPage panels={panels} embeddedSection="vault" />);
  await expect.element(screen.getByRole("button", { name: "Open Vault" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Manage models" }))
    .not.toBeInTheDocument();
});
