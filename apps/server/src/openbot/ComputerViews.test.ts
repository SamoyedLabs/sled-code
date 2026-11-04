import { expect, it } from "@effect/vitest";
import { ComputerViews } from "./ComputerViews.ts";
import type { ComputerSession } from "./ComputerViewSession.ts";

function fixture() {
  let now = 1000;
  let allowed = true;
  const closed: string[] = [];
  const views = new ComputerViews({
    now: () => now,
    authorize: async () => {
      if (!allowed) throw new Error("revoked");
    },
    create: async () =>
      ({
        target: "/moonlight/stream.html",
        upstreamId: "private-id",
        isClosed: () => false,
        request: async () => {
          throw new Error("unused");
        },
        dial: () => {
          throw new Error("unused");
        },
        test: async () => {
          throw new Error("unused");
        },
        close: async () => {
          closed.push("owned");
        },
      }) satisfies ComputerSession,
  });
  return {
    views,
    closed,
    time: (value: number) => {
      now = value;
    },
    revoke: () => {
      allowed = false;
    },
  };
}
it("isolates owners, consumes tickets once, and expires active leases", async () => {
  const f = fixture();
  try {
    const grant = await f.views.open("alice", "host", "https://app.example");
    await expect(f.views.close("bob", "host", grant.id)).rejects.toThrow();
    await expect(f.views.close("alice", "other", grant.id)).rejects.toThrow();
    await expect(f.views.claim(grant.id, "0".repeat(64))).rejects.toThrow();
    expect(f.closed).toEqual([]);
    const cookie = await f.views.claim(grant.id, grant.ticket);
    await expect(f.views.claim(grant.id, grant.ticket)).rejects.toThrow();
    await expect(f.views.access(grant.id, "0".repeat(64))).rejects.toThrow();
    f.time(901000);
    await expect(f.views.access(grant.id, cookie)).rejects.toThrow();
    expect(f.closed).toEqual(["owned"]);
  } finally {
    await f.views.stop();
  }
});
it("rechecks authority and tears down stream stops on revocation", async () => {
  const f = fixture();
  try {
    const grant = await f.views.open("alice", "host", "https://app.example");
    const cookie = await f.views.claim(grant.id, grant.ticket);
    let stopped = false;
    (await f.views.access(grant.id, cookie)).stops.add(() => {
      stopped = true;
    });
    f.revoke();
    await f.views.sweep();
    expect(stopped).toBe(true);
    expect(f.closed).toEqual(["owned"]);
  } finally {
    await f.views.stop();
  }
});

it("closes a late created session when shutdown wins the creation race", async () => {
  const entered = Promise.withResolvers<void>();
  const created = Promise.withResolvers<ComputerSession>();
  let closed = false;
  const views = new ComputerViews({
    authorize: async () => {},
    create: async () => {
      entered.resolve();
      return created.promise;
    },
  });
  const opening = views.open("alice", "host", "https://app.example");
  await entered.promise;
  await views.stop();
  created.resolve({
    target: "/moonlight/stream.html",
    upstreamId: "late",
    isClosed: () => false,
    request: async () => {
      throw new Error("unused");
    },
    dial: () => {
      throw new Error("unused");
    },
    test: async () => {
      throw new Error("unused");
    },
    close: async () => {
      closed = true;
    },
  });
  await expect(opening).rejects.toThrow();
  expect(closed).toBe(true);
});
