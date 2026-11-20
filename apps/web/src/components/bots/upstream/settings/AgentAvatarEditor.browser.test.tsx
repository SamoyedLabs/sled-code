/* oxlint-disable shadcn/no-unknown-classes -- Exercises the actual source avatar editor and its scoped styles. */
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { AgentAvatarEditor } from "./AgentAvatarEditor";
import "~/index.css";
import "../openbot-react.css";
import "../../sled-bots.css";

it.each([
  { width: 1000, height: 680 },
  { width: 320, height: 420 },
])(
  "opens a bounded avatar picker outside a scrolling panel at $width px",
  async ({ width, height }) => {
    await page.viewport(width, height);
    const update = vi.fn(async () => {});
    const upload = vi.fn(async () => {});
    await using screen = await render(
      <div className="openbot-react bot-settings-surface h-80 w-96 max-w-full overflow-y-auto border p-6">
        <AgentAvatarEditor
          agent={{ id: "avatar-test", avatarSeed: "avatar-test", avatarHue: 55 }}
          onUpdate={update}
          onSetAvatar={upload}
        />
      </div>,
    );
    await screen.getByRole("button", { name: "Edit agent avatar" }).click();
    const picker = page.getByRole("dialog", { name: "Avatar editor" });
    await expect.element(picker).toBeVisible();
    const shapes = page.getByRole("group", { name: "Avatar shapes" }).element();
    expect(getComputedStyle(shapes).display).toBe("grid");
    const tiles = Array.from(shapes.querySelectorAll("button")).map((button) =>
      button.getBoundingClientRect(),
    );
    await vi.waitFor(() => expect(tiles[0]!.width).toBeGreaterThan(0));
    expect(new Set(tiles.slice(0, 5).map((tile) => Math.round(tile.top))).size).toBe(1);
    expect(tiles[5]!.top).toBeGreaterThan(tiles[0]!.top);
    const bounds = picker.element().getBoundingClientRect();
    expect(bounds.width).toBeGreaterThanOrEqual(260);
    expect(bounds.width).toBeLessThanOrEqual(300);
    expect(bounds.top).toBeGreaterThanOrEqual(8);
    expect(bounds.bottom).toBeLessThanOrEqual(height - 8);
    expect(bounds.left).toBeGreaterThanOrEqual(8);
    expect(bounds.right).toBeLessThanOrEqual(width - 8);
    const firstChoice = page.getByRole("button", { name: "Shape 1", exact: true }).element();
    const choice = firstChoice.getBoundingClientRect();
    expect(
      firstChoice.contains(
        document.elementFromPoint(choice.x + choice.width / 2, choice.y + choice.height / 2),
      ),
    ).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Automatic avatar color" }).click();
    await vi.waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith({ avatarHue: null }));
    await userEvent.keyboard("{Escape}");
    await expect.element(picker).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Edit agent avatar" })).toHaveFocus();
  },
);

it("bounds a custom image in the trigger and upload preview", async () => {
  await page.viewport(1000, 680);
  const image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1600"><rect width="800" height="1600" fill="blue"/></svg>',
    );
  await using screen = await render(
    <div className="openbot-react bot-settings-surface">
      <AgentAvatarEditor
        agent={{ id: "photo-test", avatarSeed: "photo-test", avatarHue: null, avatarUrl: image }}
        onUpdate={async () => {}}
        onSetAvatar={async () => {}}
      />
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Edit agent avatar" });
  const imageRect = trigger.element().querySelector("img")!.getBoundingClientRect();
  expect(imageRect.width).toBe(62);
  expect(imageRect.height).toBe(62);
  await trigger.click();
  const preview = page
    .getByRole("button", { name: /Replace image/ })
    .element()
    .querySelector("img")!
    .getBoundingClientRect();
  expect(preview.width).toBe(42);
  expect(preview.height).toBe(42);
});
