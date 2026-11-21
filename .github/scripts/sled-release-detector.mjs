const FEED = "https://github.com/pingdotgg/t3code/releases.atom";
const STATE = "nightly";

function order(tag) {
  const match = /-nightly\.(\d{8})\.(\d+)$/.exec(tag);
  return [Number(match[1]), Number(match[2])];
}

function newer(left, right) {
  const a = order(left);
  const b = order(right);
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

export function latestNightly(feed) {
  const tags = [
    ...feed.matchAll(
      /<link\b[^>]*\bhref="https:\/\/github\.com\/pingdotgg\/t3code\/releases\/tag\/(v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+)"/g,
    ),
  ].map((match) => match[1]);
  if (!tags.length) throw new Error("No published nightly found in the release feed");
  return tags.reduce((latest, tag) => (newer(tag, latest) ? tag : latest));
}

export async function detect(env, request = fetch) {
  const previous = await env.RELEASES.get(STATE, "json");
  const headers = {
    "User-Agent": "Sled-Upstream-Release-Detector",
    Accept: "application/atom+xml",
  };
  if (previous?.etag) headers["If-None-Match"] = previous.etag;
  const response = await request(FEED, { headers });
  if (response.status === 304) return { status: "unchanged", tag: previous?.tag };
  if (!response.ok) throw new Error(`Release feed returned HTTP ${response.status}`);
  const tag = latestNightly(await response.text());
  const etag = response.headers.get("etag");
  if (previous && !newer(tag, previous.tag)) {
    if (etag !== previous.etag) {
      await env.RELEASES.put(STATE, JSON.stringify({ ...previous, etag }));
    }
    return { status: "unchanged", tag: previous.tag };
  }
  if (!env.WEBHOOK_URL) throw new Error("Release notification webhook is not configured");
  // Never log the webhook URL, which contains a private delivery token.
  const delivery = await request(env.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "sled.upstream.release", repository: "pingdotgg/t3code", tag }),
  }).catch(() => {
    throw new Error("Release webhook transport failed");
  });
  if (!delivery.ok) throw new Error(`Release webhook returned HTTP ${delivery.status}`);
  await env.RELEASES.put(
    STATE,
    JSON.stringify({ tag, etag, notifiedAt: new Date().toISOString() }),
  );
  return { status: "notified", tag };
}

export default {
  async scheduled(_controller, env) {
    console.log(JSON.stringify(await detect(env)));
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/health" || request.method !== "GET") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({
      service: "sled-release-detector",
      lastNotification: await env.RELEASES.get(STATE, "json"),
    });
  },
};
