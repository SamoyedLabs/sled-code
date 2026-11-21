import { describe, expect, it } from "@effect/vitest";
import { signImportBinding, verifyImportBinding } from "./ImportBinding.ts";
const request = {
  principal: "session-a",
  hostId: "host-a",
  method: "POST",
  path: "/v1/sled-agent-import/apply",
  bodySha256: "a".repeat(64),
};
describe("trusted import principal binding", () => {
  it("binds the exact principal, host, operation and body with a short expiry", () => {
    const token = signImportBinding("owned-fixture-secret", request, 1000);
    expect(verifyImportBinding("owned-fixture-secret", token, request, 1001)).toBe("session-a");
    for (const changed of [
      { ...request, hostId: "host-b" },
      { ...request, path: "/v1/sled-agent-import/discard" },
      { ...request, bodySha256: "b".repeat(64) },
      { ...request, method: "GET" },
    ])
      expect(() => verifyImportBinding("owned-fixture-secret", token, changed, 1001)).toThrow();
    expect(() => verifyImportBinding("other-secret", token, request, 1001)).toThrow();
    expect(() => verifyImportBinding("owned-fixture-secret", token, request, 31001)).toThrow();
    expect(() => verifyImportBinding("owned-fixture-secret", token, request, 999)).toThrow();
    expect(() => verifyImportBinding("owned-fixture-secret", token + "x", request, 1001)).toThrow();
  });
});
