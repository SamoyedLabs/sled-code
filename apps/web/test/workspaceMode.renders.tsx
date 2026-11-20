import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { commands, page } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startMainAppLocationTracking } from "~/components/sidebar/mainAppLocation";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "./fakeEnvironment";
import { startCounting, stopCounting } from "./renderCounter";
import { render } from "./render";

// The socket is the only fake layer: client-runtime's driver hands every connection the
// in-process session. A string path, since a typed import pulls client-runtime's sources
// into this project, and imports inside, since the factory runs before this file's own.
vi.mock("../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("./fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

// The fake server leaves most requests unanswered, which would raise the slow-request toast
// 15s of wall clock after each one, at a different point in every run.
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const thread = threadWithHistory("workspace-mode-thread", 3);
installFakeEnvironment([thread]);
await page.viewport(1400, 900);
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

it("retains the actual sidebar and shared mode controls across Bots and Threads round trips", async () => {
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  using _tracking = { [Symbol.dispose]: startMainAppLocationTracking(router) };
  document.documentElement.classList.add("dark");
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1400px;";
  await using _screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(page.getByText(`Answer 2 for ${thread.id}.`)).toBeVisible();
  const header = container.querySelector(".workspace-sidebar-header")!;
  const pill = header.querySelector(".workspace-view-indicator");
  const sidebar = container.querySelector("[data-app-sidebar]");
  const width = header.getBoundingClientRect().width;
  startCounting();
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await expect.element(page.getByRole("complementary", { name: "Bot chats" })).toBeVisible();
  const botSidebar = page.getByRole("complementary", { name: "Bot chats" }).element();
  expect(botSidebar.getBoundingClientRect().width).toBe(width);
  expect(container.querySelector(".workspace-sidebar-header")).toBe(header);
  expect(header.querySelector(".workspace-view-indicator")).toBe(pill);
  expect(container.querySelector("[data-app-sidebar]")).toBe(sidebar);
  await commands.writeRenderReport(
    "workspace-mode-bots",
    JSON.stringify({
      width,
      botsWidth: botSidebar.getBoundingClientRect().width,
      sharedHeader: true,
      retainedThreadSidebar: true,
      renders: stopCounting(),
    }),
  );
  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await expect.element(page.getByText(`Answer 2 for ${thread.id}.`)).toBeVisible();
  expect(header.querySelector(".workspace-view-indicator")).toBe(pill);
  expect(container.querySelector("[data-app-sidebar]")).toBe(sidebar);
  await commands.writeRenderReport(
    "workspace-mode-threads",
    JSON.stringify({
      width: header.getBoundingClientRect().width,
      sharedHeader: true,
      retainedThreadSidebar: true,
    }),
  );
});
