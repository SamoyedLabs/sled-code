/* oxlint-disable shadcn/no-unknown-classes -- Tests source scoped provider UI. */
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { ProviderSettingsPage } from "./ProviderSettingsPage";
import { ProviderKeyDialog, SourceSignInRelayControls } from "./ProviderSignInDialogs";
import type { ProviderSettingsOption } from "./provider-settings-model";
import "~/index.css";
import "../openbot-tokens.css";
import "../openbot-react.css";
const options: ProviderSettingsOption[] = [
  {
    id: "codex",
    name: "ChatGPT",
    state: "available",
    version: null,
    message: null,
    usedBy: ["Writer"],
    accounts: [
      {
        id: "default",
        label: "Personal",
        email: "me@example.test",
        state: "connected",
        message: null,
        usedBy: ["Writer"],
      },
      {
        id: "a0000000000000002",
        label: "Work",
        email: "work@example.test",
        state: "signed-out",
        message: null,
        usedBy: [],
      },
    ],
  },
];
it("searches account emails and retains rename editing until explicit keyboard completion", async () => {
  const rename = vi.fn(async () => {});
  await using _view = await render(
    <div className="openbot-react">
      <ProviderSettingsPage options={options} usage={[]} actions={() => ({ rename })} />
    </div>,
  );
  await page.getByRole("textbox", { name: "Search providers" }).fill("work@example");
  await page.getByRole("button", { name: "Open ChatGPT" }).click();
  await page.getByRole("button", { name: "More actions for Personal" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Name of Personal" });
  await field.fill("Everyday");
  await userEvent.keyboard("{Enter}");
  expect(rename).toHaveBeenCalledWith("codex", "default", "Everyday");
  await expect.element(page.getByText("work@example.test", { exact: false })).toBeVisible();
});
it("keeps saved keys write-only and does not submit an empty replacement", async () => {
  const save = vi.fn(async () => {}),
    remove = vi.fn(async () => {});
  await using _view = await render(
    <ProviderKeyDialog
      provider="claude"
      name="Claude"
      status="saved"
      busy={false}
      error={null}
      onClose={() => {}}
      onSave={save}
      onRemove={remove}
    />,
  );
  await expect.element(page.getByRole("button", { name: "Save key" })).toBeDisabled();
  const field = page.getByRole("textbox", { name: "Anthropic API key" });
  await field.fill("new-secret-value");
  await page.getByRole("button", { name: "Save key" }).click();
  expect(save).toHaveBeenCalledWith("new-secret-value");
  await expect.element(field).toHaveValue("");
});
it("does not offer a callback field for a relay device page", async () => {
  const open = vi.fn();
  await using _view = await render(
    <div className="openbot-react">
      <SourceSignInRelayControls
        page={{ authorizeHost: "login.example.test", listening: false, pasteable: false }}
        onOpen={open}
        onPaste={async () => {}}
      />
    </div>,
  );
  await page.getByRole("button", { name: "Open sign-in page" }).click();
  expect(open).toHaveBeenCalledOnce();
  await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
});

it("offers the source callback alternative through the default account menu", async () => {
  const alternative = vi.fn();
  await using _view = await render(
    <div className="openbot-react">
      <ProviderSettingsPage
        options={options}
        usage={[]}
        actions={() => ({
          rename: async () => {},
          alternative: { kind: "address", run: alternative },
        })}
      />
    </div>,
  );
  await page.getByRole("button", { name: "Open ChatGPT" }).click();
  await page.getByRole("button", { name: "More actions for Personal" }).click();
  await page.getByRole("menuitem", { name: "Paste the address" }).click();
  expect(alternative).toHaveBeenCalledOnce();
});
