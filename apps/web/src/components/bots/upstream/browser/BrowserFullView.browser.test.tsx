/* oxlint-disable shadcn/no-unknown-classes -- Render the actual source browser scope and styles. */
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { BrowserFullView } from "./BrowserFullView";
import type { BrowserViewProps } from "./types";
import "~/index.css";
import "../openbot-tokens.css";
import "../openbot-react.css";
it("uses the source address, tab and desktop shortcuts with exact tab identities", async () => {
  const first = {
    id: "first",
    url: "https://first.example.com",
    title: "First page",
    loading: false,
    ownerAgentId: null,
    ownerThreadId: null,
    canGoBack: false,
  };
  const second = {
    id: "second",
    url: "https://second.example.com",
    title: "Second page",
    loading: false,
    ownerAgentId: null,
    ownerThreadId: null,
  };
  const view: BrowserViewProps = {
    tabs: [first, second],
    activeTab: first,
    history: [],
    canReopen: true,
    canControl: true,
    canCloseTabs: true,
    shortcuts: "mac",
    onActivateTab: vi.fn(),
    onCloseTabs: vi.fn(),
    onNewTab: vi.fn(async () => {}),
    onDuplicateTab: vi.fn(),
    onMoveTab: vi.fn(),
    onReopenTab: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
    onNavigate: vi.fn(),
    onOpenAddress: vi.fn(),
    onBack: vi.fn(),
    page: <p>Owned viewer surface</p>,
  };
  await using screen = await render(
    <div className="openbot-react">
      <BrowserFullView {...view} />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "Go back", exact: true })).toBeDisabled();
  const address = page.getByRole("combobox", { name: "Browser address" });
  await address.fill("example.org");
  await userEvent.keyboard("{Enter}");
  expect(view.onOpenAddress).toHaveBeenCalledWith("https://example.org", "first");
  await userEvent.keyboard("{Meta>}{2}{/Meta}");
  expect(view.onActivateTab).toHaveBeenCalledWith("second");
  await userEvent.keyboard("{Meta>}{r}{/Meta}");
  expect(view.onReload).toHaveBeenCalledWith("first");
  await userEvent.keyboard("{Meta>}{w}{/Meta}");
  expect(view.onCloseTabs).toHaveBeenCalledWith(["first"]);
  await expect.element(screen.getByText("Owned viewer surface")).toBeVisible();
});
