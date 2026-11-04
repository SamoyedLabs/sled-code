import { expect, it } from "@effect/vitest";
import { BrowserViews } from "./BrowserViews.ts";

it("closes a session created while the viewer owner is shutting down", async () => {
  const entered = Promise.withResolvers<void>();
  const created = Promise.withResolvers<void>();
  const closed: string[] = [];
  const views = new BrowserViews({
    authorize: async () => {},
    create: async (_hostId, tabId) => {
      const session = {
        create: async (tabId: string) => {
          entered.resolve();
          await created.promise;
          return { id: "late", tabId, streamPath: "/v1/browser/view/sessions/late/stream" };
        },
        close: async (id: string) => {
          closed.push(id);
        },
        dial: () => {
          throw new Error("must not dial");
        },
      };
      return { session, upstream: await session.create(tabId) };
    },
  });
  const opening = views.open("alice", "host", "tab");
  await entered.promise;
  await views.stop();
  created.resolve();
  try {
    await expect(opening).rejects.toThrow();
    expect(closed).toEqual(["late"]);
  } finally {
    await views.stop();
  }
});

it("confines a viewer to its destination and principal and expires/revokes it before dialing", async () => {
  let now = 1000;
  let allowed = true;
  const closed: string[] = [];
  const views = new BrowserViews({
    now: () => now,
    authorize: async () => {
      if (!allowed) throw new Error("revoked");
    },
    create: async (_hostId, tabId) => {
      const session = {
        create: async (tabId: string) => ({
          id: "owned",
          tabId,
          streamPath: "/v1/browser/view/sessions/owned/stream",
        }),
        close: async (id: string) => {
          closed.push(id);
        },
        dial: () => {
          throw new Error("must not dial");
        },
      };
      return { session, upstream: await session.create(tabId) };
    },
  });
  const grant = await views.open("alice", "host-one", "tab-one");
  expect(JSON.stringify(grant)).not.toContain("streamPath");
  await expect(views.connect("bob", "host-one", grant.id, grant.token)).rejects.toThrow();
  await expect(views.connect("alice", "host-two", grant.id, grant.token)).rejects.toThrow();
  await expect(views.close("bob", "host-one", grant.id)).rejects.toThrow();
  expect(closed).toEqual([]);
  now = grant.expiresAt;
  await expect(views.connect("alice", "host-one", grant.id, grant.token)).rejects.toThrow();
  expect(closed).toEqual(["owned"]);
  now = 1000;
  const second = await views.open("alice", "host-one", "tab-one");
  allowed = false;
  await expect(views.connect("alice", "host-one", second.id, second.token)).rejects.toThrow();
  expect(closed).toEqual(["owned", "owned"]);
});
