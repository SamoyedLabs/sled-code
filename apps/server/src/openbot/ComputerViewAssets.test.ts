import { expect, it } from "@effect/vitest";
import { rewriteComputerAsset } from "./ComputerViewAssets.ts";
it("preserves the released Moonlight session matcher and routes state reports through the Sled lease", () => {
  const source = String.raw`const match = /^\/v1\/remote-screen\/sessions\/([A-Za-z0-9-]+)\/moonlight(?:\/|$)/.exec(location.pathname); const sessionId=match?.[1]; return { sessionId, endpoint: \`/v1/remote-screen/sessions/\${sessionId}/viewer-state\` };`;
  const rewritten = rewriteComputerAsset(
    new TextEncoder().encode(source.replaceAll("\\`", "`").replaceAll("\\${", "${")),
    "private-id",
    "/api/openbot/computer-view/v1/remote-screen/sessions/public-id",
  );
  const execute = new Function("location", rewritten);
  expect(
    execute({
      pathname:
        "/api/openbot/computer-view/v1/remote-screen/sessions/public-id/moonlight/stream.html",
    }),
  ).toEqual({
    sessionId: "public-id",
    endpoint: "/api/openbot/computer-view/v1/remote-screen/sessions/public-id/viewer-state",
  });
  expect(
    rewriteComputerAsset(
      new TextEncoder().encode(
        'export default {path_prefix:"/v1/remote-screen/sessions/private-id/moonlight"}',
      ),
      "private-id",
      "/public",
    ),
  ).not.toContain("private-id");
});
