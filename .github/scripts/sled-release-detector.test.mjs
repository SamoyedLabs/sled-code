import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { detect, latestNightly } from "./sled-release-detector.mjs";

const old = "v0.1.10-nightly.20261111.4544";
const current = "v0.1.10-nightly.20261112.4564";
const feed = (tags) =>
  tags
    .map(
      (tag) =>
        `<entry><link href="https://github.com/pingdotgg/t3code/releases/tag/${tag}"/></entry>`,
    )
    .join("");

function fixture(initial) {
  let state = initial;
  const notifications = [];
  const env = {
    WEBHOOK_URL: "https://example.invalid/private-delivery-token",
    RELEASES: {
      get: async () => state,
      put: async (_key, value) => {
        state = JSON.parse(value);
      },
    },
  };
  const request = async (url, options) => {
    if (url === env.WEBHOOK_URL) {
      notifications.push(JSON.parse(options.body));
      return new Response(null, { status: 202 });
    }
    return new Response(feed([current, old]), { headers: { etag: '"fresh"' } });
  };
  return { env, notifications, request, state: () => state };
}

NodeTest.test(
  "finds the newest published nightly despite stable, preview and reordered entries",
  () => {
    NodeAssert.equal(
      latestNightly(
        feed([old, "v0.1.10", current, "v0.1.11-preview.20261113.4565"]) +
          "<content>https://github.com/pingdotgg/t3code/releases/tag/v0.1.11-nightly.20261113.9999 </content>",
      ),
      current,
    );
    NodeAssert.throws(() => latestNightly(feed(["v0.1.10"])), /No published nightly/);
  },
);

NodeTest.test(
  "notifies on a new nightly, persists successful delivery and suppresses repeat checks",
  async () => {
    const f = fixture({ tag: old });
    NodeAssert.deepEqual(await detect(f.env, f.request), { status: "notified", tag: current });
    NodeAssert.deepEqual(f.notifications, [
      { event: "sled.upstream.release", repository: "pingdotgg/t3code", tag: current },
    ]);
    NodeAssert.equal(f.state().tag, current);
    NodeAssert.deepEqual(await detect(f.env, f.request), { status: "unchanged", tag: current });
    NodeAssert.equal(f.notifications.length, 1);
  },
);

NodeTest.test("failed notification remains retryable without consuming the feed etag", async () => {
  const f = fixture({ tag: old, etag: '"old"' });
  const failed = async (url, options) =>
    url === f.env.WEBHOOK_URL ? new Response(null, { status: 503 }) : f.request(url, options);
  await NodeAssert.rejects(detect(f.env, failed), /HTTP 503/);
  NodeAssert.deepEqual(f.state(), { tag: old, etag: '"old"' });
  NodeAssert.equal((await detect(f.env, f.request)).status, "notified");
});

NodeTest.test(
  "conditional responses and an older feed never produce a duplicate or regression",
  async () => {
    const f = fixture({ tag: current, etag: '"fresh"' });
    await detect(f.env, async (_url, options) => {
      NodeAssert.equal(options.headers["If-None-Match"], '"fresh"');
      return new Response(null, { status: 304 });
    });
    await detect(f.env, async () => new Response(feed([old])));
    NodeAssert.equal(f.state().tag, current);
    NodeAssert.equal(f.notifications.length, 0);
  },
);

NodeTest.test("a feed failure preserves delivery state and does not notify", async () => {
  const f = fixture({ tag: old });
  await NodeAssert.rejects(
    detect(f.env, async () => new Response(null, { status: 429 })),
    /HTTP 429/,
  );
  NodeAssert.equal(f.state().tag, old);
  NodeAssert.equal(f.notifications.length, 0);
});
