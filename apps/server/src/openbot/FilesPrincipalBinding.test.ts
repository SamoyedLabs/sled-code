import { describe, expect, it } from "@effect/vitest";
import { signFilesPrincipalBinding, verifyFilesPrincipalBinding } from "./FilesPrincipalBinding.ts";
const request = {
  principal: "session-a",
  hostId: "host-a",
  method: "POST",
  path: "/v1/sled/files/upload",
  bodySha256: "a".repeat(64),
};
describe("trusted Files principal binding", () => {
  it("binds the exact principal, host, operation and body with a short expiry", () => {
    expect(() =>
      signFilesPrincipalBinding(
        "owned-fixture-secret",
        { ...request, path: "/v1/sled-agent-import/apply" },
        1000,
      ),
    ).toThrow();
    expect(() =>
      signFilesPrincipalBinding(
        "owned-fixture-secret",
        { ...request, path: "/v1/sled/files/upload?path=other" },
        1000,
      ),
    ).toThrow();
    const token = signFilesPrincipalBinding("owned-fixture-secret", request, 1000);
    expect(verifyFilesPrincipalBinding("owned-fixture-secret", token, request, 1001)).toBe(
      "session-a",
    );
    for (const changed of [
      { ...request, hostId: "host-b" },
      { ...request, path: "/v1/sled/files/upload-cancel" },
      { ...request, bodySha256: "b".repeat(64) },
      { ...request, method: "GET" },
    ])
      expect(() =>
        verifyFilesPrincipalBinding("owned-fixture-secret", token, changed, 1001),
      ).toThrow();
    expect(() => verifyFilesPrincipalBinding("other-secret", token, request, 1001)).toThrow();
    expect(() =>
      verifyFilesPrincipalBinding("owned-fixture-secret", token, request, 31001),
    ).toThrow();
    expect(() =>
      verifyFilesPrincipalBinding("owned-fixture-secret", token, request, 999),
    ).toThrow();
    expect(() =>
      verifyFilesPrincipalBinding("owned-fixture-secret", token + "x", request, 1001),
    ).toThrow();
  });
});
