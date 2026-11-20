/* oxlint-disable shadcn/no-unknown-classes -- Source profile settings render inside their scoped workspace. */
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { BrowserProfilesPanel } from "./BrowserProfilesSettings";
import "~/index.css";
import "../openbot-react.css";
const confirmation = vi.hoisted(() => vi.fn());
vi.mock("../../../../confirmDialog", () => ({ requestConfirmDialog: confirmation }));
it("keeps a failed rename editable, and Escape restores the original profile without another mutation", async () => {
  const act = vi.fn().mockResolvedValue(false);
  await using screen = await render(
    <div className="openbot-react">
      <BrowserProfilesPanel
        profiles={[
          {
            id: "owned-profile",
            name: "Original profile",
            hue: 55,
            agentIds: ["agent"],
            tabCount: 2,
          },
        ]}
        disabled={false}
        error={null}
        onAction={act}
        onRefresh={vi.fn()}
      />
    </div>,
  );
  await screen.getByRole("button", { name: "Actions for Original profile" }).click();
  await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const name = screen.getByRole("textbox", { name: "Rename Original profile" });
  await name.fill("Edited profile");
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  expect(act).toHaveBeenCalledExactlyOnceWith({
    operation: "browser.profiles.update",
    profileId: "owned-profile",
    name: "Edited profile",
  });
  await expect.element(name).toHaveValue("Edited profile");
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByText("Original profile", { exact: true })).toBeVisible();
  expect(act).toHaveBeenCalledOnce();
});
it("keeps cancelled clear/delete read-only and targets only the confirmed profile", async () => {
  const act = vi.fn().mockResolvedValue(true);
  confirmation.mockReset().mockResolvedValue(false);
  const props = {
    profiles: [{ id: "owned-profile", name: "Owned profile", hue: 55, agentIds: [], tabCount: 0 }],
    disabled: false,
    error: null,
    onAction: act,
    onRefresh: vi.fn(),
  };
  await using screen = await render(
    <div className="openbot-react">
      <BrowserProfilesPanel {...props} />
    </div>,
  );
  for (const name of ["Clear sign-ins", "Delete profile"]) {
    await screen.getByRole("button", { name: "Actions for Owned profile" }).click();
    await screen.getByRole("menuitem", { name, exact: true }).click();
  }
  expect(confirmation).toHaveBeenCalledTimes(2);
  expect(act).not.toHaveBeenCalled();
  confirmation.mockResolvedValue(true);
  await screen.getByRole("button", { name: "Color for Owned profile" }).click();
  await screen.getByRole("menuitem", { name: "Blue", exact: true }).click();
  expect(act).toHaveBeenLastCalledWith({
    operation: "browser.profiles.update",
    profileId: "owned-profile",
    hue: 215,
  });
  for (const { name, operation } of [
    { name: "Clear sign-ins", operation: "browser.profiles.clear" },
    { name: "Delete profile", operation: "browser.profiles.delete" },
  ]) {
    await screen.getByRole("button", { name: "Actions for Owned profile" }).click();
    await screen.getByRole("menuitem", { name, exact: true }).click();
    expect(act).toHaveBeenLastCalledWith({ operation, profileId: "owned-profile" });
  }
  await screen.rerender(
    <div className="openbot-react">
      <BrowserProfilesPanel {...props} disabled />
    </div>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Actions for Owned profile" }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Color for Owned profile" }))
    .toBeDisabled();
});
