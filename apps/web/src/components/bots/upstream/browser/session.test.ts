import { expect, it } from "vite-plus/test";
import {
  emptyBrowserSession,
  syncBrowserSession,
  orderedTabs,
  rememberClosed,
  moveTab,
} from "./session";
const tab = (id: string, url = `https://${id}.example.com`) => ({
  id,
  title: id,
  url,
  loading: false,
  ownerAgentId: null,
  ownerThreadId: null,
});
it("reconciles host tabs without losing a local reorder or counting title changes as visits", () => {
  const tabs = [tab("first"), tab("second")];
  const session = syncBrowserSession(emptyBrowserSession(), tabs);
  const moved = moveTab(session, tabs, "second", 0);
  const refreshed = syncBrowserSession(moved, [{ ...tabs[0]!, title: "New title" }, tabs[1]!]);
  expect(orderedTabs(refreshed, tabs).map((t) => t.id)).toEqual(["second", "first"]);
  expect(refreshed.history.find((h) => h.url === tabs[0]!.url)).toMatchObject({
    title: "New title",
    visits: 1,
  });
});
it("inserts a new host tab beside its opener and retains only actually closed tab locations", () => {
  const tabs = [tab("first"), tab("second")];
  const session = syncBrowserSession(
    { ...syncBrowserSession(emptyBrowserSession(), tabs), pending: { afterId: "first" } },
    [...tabs, { ...tab("popup"), openerTabId: "first" }],
  );
  expect(session.order).toEqual(["first", "popup", "second"]);
  expect(rememberClosed(session, tabs, ["second", "missing"]).closed).toEqual([
    { url: tabs[1]!.url, index: 1 },
  ]);
});
