import { expect, it } from "@effect/vitest";
import { computerProxyPath, createComputerViewSession } from "./ComputerViewSession.ts";
it("bounds the Moonlight family and refuses generic host or traversal paths", () => {
  for (const path of [
    "/moonlight/stream.html?hostId=1&appId=2",
    "/moonlight/config.js",
    "/moonlight/assets/decoder.wasm",
    "/moonlight/api/role",
  ])
    expect(computerProxyPath(path, "GET")).toBe(true);
  for (const path of [
    "/moonlight/admin.html",
    "/moonlight/api/host",
    "/moonlight/../config.js",
    "/moonlight/%2e%2e/config.js",
    "/moonlight//elsewhere",
    "/authorize",
    "/moonlight/stream.html#x",
  ])
    expect(computerProxyPath(path, "GET")).toBe(false);
  expect(computerProxyPath("/moonlight/openbot-clipboard", "POST")).toBe(true);
  expect(computerProxyPath("/moonlight/api/role", "POST")).toBe(false);
});
it("exchanges the upstream grant privately, keeps its cookie on private requests, and closes its exact session", async () => {
  const deleted: string[] = [];
  const calls: { url: string; body?: string | Uint8Array; headers?: Record<string, string> }[] = [];
  const session = await createComputerViewSession({
    origin: "http://127.0.0.1:1234",
    http: async (url, init) => {
      calls.push({ url: String(url), ...init });
      if (String(url).endsWith("/authorize"))
        return {
          status: 204,
          headers: new Headers({ "set-cookie": "openbot_viewer=secretcookie; HttpOnly" }),
          bytes: new Uint8Array(),
        };
      if (String(url).endsWith("/viewer"))
        return {
          status: 200,
          headers: new Headers(),
          bytes: new TextEncoder().encode(
            'location.replace("/v1/remote-screen/sessions/private-id/moonlight/stream.html?hostId=1&appId=2");',
          ),
        };
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/javascript", "set-cookie": "do-not-forward" }),
        bytes: new TextEncoder().encode("export default {}"),
      };
    },
    isClosed: () => false,
    request: async (path, method) => {
      if (method === "DELETE") {
        deleted.push(path);
        return null;
      }
      return { id: "private-id", viewerGrant: "secret-grant", viewerUrl: "must-never-follow" };
    },
  });
  try {
    const response = await session.request("/moonlight/config.js", "GET");
    expect(response).toEqual({
      status: 200,
      type: "text/javascript",
      bytes: new TextEncoder().encode("export default {}"),
    });
    expect(calls[0]?.body).toBe('{"grant":"secret-grant"}');
    expect(calls[2]?.headers).toMatchObject({ cookie: "openbot_viewer=secretcookie" });
    await expect(session.request("/moonlight/../admin", "GET")).rejects.toThrow();
  } finally {
    await session.close();
  }
  await session.close();
  expect(deleted).toEqual(["/v1/remote-screen/sessions/private-id"]);
});
