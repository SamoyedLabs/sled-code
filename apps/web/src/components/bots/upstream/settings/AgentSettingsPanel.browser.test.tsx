/* oxlint-disable shadcn/no-unknown-classes -- The test renders the actual scoped source styles and Sled theme adapter. */
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { AgentSettingsPanel } from "./AgentSettingsPanel";
import "~/index.css";
import "../openbot-react.css";
import "../../sled-bots.css";
import "../openbot-side-thread-tabs.css";

it("preserves profile saves and section return navigation in the settings page layout", async () => {
  const update = vi.fn(async () => {});
  const close = vi.fn();
  await using screen = await render(
    <div className="openbot-react bot-settings-surface">
      <AgentSettingsPanel
        layout="page"
        agent={{
          id: "profile-test",
          name: "Research bot",
          title: "",
          description: "",
          avatarSeed: "profile-test",
          avatarHue: 215,
        }}
        onClose={close}
        onUpdateAgent={update}
        sections={[
          {
            id: "permissions",
            label: "Permissions",
            group: "Rules",
            content: <button>Permission control</button>,
          },
        ]}
      />
    </div>,
  );
  await expect
    .element(screen.getByRole("heading", { name: "Bot settings" }))
    .not.toBeInTheDocument();
  await screen
    .getByRole("textbox", { name: "Agent name", exact: true })
    .fill("Research and writing");
  await screen.getByRole("button", { name: "Permissions", exact: true }).click();
  await vi.waitFor(() =>
    expect(update).toHaveBeenCalledExactlyOnceWith("profile-test", {
      name: "Research and writing",
    }),
  );
  await expect.element(screen.getByRole("button", { name: "Permission control" })).toBeVisible();
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Agent name", exact: true }))
    .toHaveValue("Research and writing");
  await expect
    .element(screen.getByRole("button", { name: "Permissions", exact: true }))
    .toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await screen.getByRole("button", { name: "Close settings", exact: true }).click();
  expect(close).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledTimes(1);
});

it("leaves pane chrome to the dock while keeping detail back navigation available", async () => {
  await using screen = await render(
    <div className="openbot-react">
      <div className="side-panel-docked">
        <AgentSettingsPanel
          agent={{
            id: "docked-profile",
            name: "Writer",
            title: "",
            description: "",
            avatarSeed: "writer",
            avatarHue: 55,
          }}
          onClose={() => {}}
          sections={[
            {
              id: "permissions",
              label: "Permissions",
              group: "Rules",
              content: <button>Permission control</button>,
            },
          ]}
        />
      </div>
    </div>,
  );
  await expect.element(screen.getByRole("heading", { name: "Bot settings" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Close settings" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Permissions", exact: true }))
    .toHaveFocus();
});
