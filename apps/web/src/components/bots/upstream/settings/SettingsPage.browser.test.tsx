/* oxlint-disable shadcn/no-unknown-classes -- Source styles require the actual OpenBot scope. */
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { AppSettingsPage } from "./SettingsPage";
import "~/index.css";
import "../openbot-react.css";
it("displays the selected source settings body on initial load and keyboard navigation", async () => {
  await using screen = await render(
    <div className="openbot-react">
      <AppSettingsPage
        panels={{ general: <h3>Appearance controls</h3>, profile: <h3>Host account controls</h3> }}
      />
    </div>,
  );
  await expect.element(screen.getByRole("heading", { name: "Appearance controls" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "General", exact: true })
    .click();
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(screen.getByRole("heading", { name: "Host account controls" }))
    .toBeVisible();
});
