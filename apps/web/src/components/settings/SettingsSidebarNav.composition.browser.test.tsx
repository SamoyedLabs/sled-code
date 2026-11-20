import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [
    { id: "theme", title: "Theme", to: "/settings/appearance" },
  ],
}));

it("ignores composing keys in the search", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });
  await search.fill("theme");
  await expect.element(page.getByRole("option", { name: /Theme/ })).toBeVisible();

  for (const composition of [
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Escape", isComposing: true, keyCode: 27 },
    { key: "Escape", isComposing: false, keyCode: 229 },
    { key: "ArrowDown", isComposing: true, keyCode: 40 },
    { key: "ArrowUp", isComposing: true, keyCode: 38 },
  ]) {
    const event = new KeyboardEvent("keydown", { ...composition, bubbles: true, cancelable: true });
    await act(() => search.element().dispatchEvent(event));
    expect(event.defaultPrevented, JSON.stringify(composition)).toBe(false);
    expect(screen.router?.state.location.pathname).toBe("/settings/general");
    await expect.element(search).toHaveValue("theme");
  }

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/settings/appearance"),
  );
});

it("keeps bot sections together and follows the selected settings route", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/bots" />
    </SidebarProvider>,
    { router: "/settings/bots#bot-host-providers" },
  );
  const botNav = screen.getByRole("navigation", { name: "Bot host settings" });
  await expect
    .element(botNav.getByRole("button", { name: "Bot models & accounts", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await botNav.getByRole("button", { name: "Bot storage", exact: true }).click();
  await vi.waitFor(() => expect(screen.router?.state.location.hash).toBe("bot-host-storage"));
  await expect
    .element(botNav.getByRole("button", { name: "Bot storage", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(botNav.getByRole("button", { name: "Bot models & accounts", exact: true }))
    .not.toHaveAttribute("aria-current");

  await page.getByRole("combobox", { name: "Search settings" }).fill("theme");
  await expect
    .element(screen.getByRole("navigation", { name: "Bot host settings" }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("option", { name: /Theme/ })).toBeVisible();
});
