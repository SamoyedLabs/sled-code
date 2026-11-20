/* oxlint-disable shadcn/no-unknown-classes -- Source storage presentation test. */
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { StorageOverview } from "./StorageOverview";
import type { StorageUsage } from "./types";
import "~/index.css";
import "../openbot-tokens.css";
import "../openbot-react.css";
const usage: StorageUsage = {
  scope: "host",
  agentId: null,
  conversationId: null,
  scannedAt: "2026-11-09T12:00:00Z",
  freeBytes: null,
  breakdown: [
    { category: "workspaces", bytes: 1024, removable: true },
    { category: "caches", bytes: 512, removable: true },
    { category: "logs", bytes: 1024, removable: false },
  ],
  agents: [],
  conversations: [],
  files: [],
  truncated: false,
};
it("only offers cleanup for the host-reported removable categories and confirms the exact category", async () => {
  const clear = vi.fn(async () => {});
  await using _view = await render(
    <div className="openbot-react">
      <StorageOverview
        hostName="Build server"
        state="ready"
        usage={usage}
        agents={[]}
        canManage
        onRescan={() => {}}
        onClear={clear}
        onFileAction={async () => {}}
      />
    </div>,
  );
  const buttons = page.getByRole("button", { name: /^Clear / });
  expect(buttons.all()).toHaveLength(1);
  await buttons.click();
  await expect
    .element(page.getByRole("alertdialog", { name: "Clear cached server files?" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  expect(clear).toHaveBeenCalledWith("caches");
});
it("does not turn a failed initial host measurement into zero usage", async () => {
  await using _view = await render(
    <div className="openbot-react">
      <StorageOverview
        hostName="Build server"
        state="error"
        error="Host unavailable"
        usage={null}
        agents={[]}
        canManage={false}
        onRescan={() => {}}
        onClear={async () => {}}
        onFileAction={async () => {}}
      />
    </div>,
  );
  await expect.element(page.getByText("Host unavailable")).toBeVisible();
  await expect.element(page.getByText("0 B", { exact: true })).not.toBeInTheDocument();
});
