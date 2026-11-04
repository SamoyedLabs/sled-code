import { expect, it } from "vite-plus/test";
import { BrowserFrameDraw, browserViewerConnection } from "./browserViewer.ts";

it("acknowledges already drawn identical pixels without waiting for another native image load", () => {
  const draw = new BrowserFrameDraw();
  expect(draw.offer({ uri: "image-a", sequence: 1 })).toBe(false);
  expect(draw.loaded(99)).toBeUndefined();
  expect(draw.loaded(1)).toBe(1);
  expect(draw.offer({ uri: "image-a", sequence: 2 })).toBe(true);
  expect(draw.loaded(1)).toBeUndefined();
  expect(draw.offer({ uri: "image-b", sequence: 3 })).toBe(false);
  expect(draw.loaded(2)).toBeUndefined();
  expect(draw.loaded(3)).toBe(3);
  expect(draw.loaded(3)).toBeUndefined();
  draw.reset();
  expect(draw.offer({ uri: "image-b", sequence: 4 })).toBe(false);
});

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
