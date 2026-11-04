import { expect, it } from "vite-plus/test";
import { browserViewerConnection } from "./browserViewer.ts";

it("keeps the selected relay prefix and media ticket while confining the viewer grant to its subprotocol", () => {
  const grant = {
    id: "view-a",
    hostId: "host-a",
    tabId: "tab-a",
    token: "a".repeat(64),
    expiresAt: 2000,
  };
  const access = {
    httpBase: "https://relay.example/environments/home/api/openbot/browser-view",
    wsBase: "wss://relay.example/environments/home/api/openbot/browser-view",
    query: { wsTicket: "media-ticket" },
    credentials: false,
  };
  expect(
    browserViewerConnection(access, grant, { hostId: "host-a", tabId: "tab-a" }, 1000),
  ).toEqual({
    url: "wss://relay.example/environments/home/api/openbot/browser-view/host-a/view-a?wsTicket=media-ticket",
    protocol: `sled-browser-view.${"a".repeat(64)}`,
  });
  for (const destination of [
    { hostId: "host-b", tabId: "tab-a" },
    { hostId: "host-a", tabId: "tab-b" },
  ])
    expect(() => browserViewerConnection(access, grant, destination, 1000)).toThrow();
  expect(() =>
    browserViewerConnection(access, grant, { hostId: "host-a", tabId: "tab-a" }, 2000),
  ).toThrow();
  expect(() =>
    browserViewerConnection(
      { ...access, wsBase: "https://relay.example/api/openbot/browser-view" },
      grant,
      { hostId: "host-a", tabId: "tab-a" },
      1000,
    ),
  ).toThrow();
});
