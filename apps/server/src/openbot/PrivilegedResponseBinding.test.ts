import { describe, expect, it } from "@effect/vitest";
import {
  signPrivilegedResponseBinding,
  verifyPrivilegedResponseBinding,
} from "./PrivilegedResponseBinding.ts";
const request = {
  principal: "session-a",
  hostId: "host-a",
  environmentId: "environment-a",
  method: "POST",
  path: "/v1/sled/privileged-responses/respond",
  bodySha256: "a".repeat(64),
};
describe("trusted privileged response binding", () => {
  it("binds the exact principal, host, operation and body with a short expiry", () => {
    expect(() =>
      signPrivilegedResponseBinding(
        "owned-fixture-secret",
        { ...request, path: "/v1/sled-agent-import/apply" },
        1000,
      ),
    ).toThrow();
    expect(() =>
      signPrivilegedResponseBinding(
        "owned-fixture-secret",
        { ...request, path: "/v1/sled/privileged-responses/respond?path=other" },
        1000,
      ),
    ).toThrow();
    const token = signPrivilegedResponseBinding("owned-fixture-secret", request, 1000);
    expect(verifyPrivilegedResponseBinding("owned-fixture-secret", token, request, 1001)).toBe(
      "session-a",
    );
    for (const changed of [
      { ...request, hostId: "host-b" },
      { ...request, environmentId: "environment-b" },
      { ...request, path: "/v1/sled/privileged-responses/result" },
      { ...request, bodySha256: "b".repeat(64) },
      { ...request, method: "GET" },
    ])
      expect(() =>
        verifyPrivilegedResponseBinding("owned-fixture-secret", token, changed, 1001),
      ).toThrow();
    expect(() => verifyPrivilegedResponseBinding("other-secret", token, request, 1001)).toThrow();
    expect(() =>
      verifyPrivilegedResponseBinding("owned-fixture-secret", token, request, 31001),
    ).toThrow();
    expect(() =>
      verifyPrivilegedResponseBinding("owned-fixture-secret", token, request, 999),
    ).toThrow();
    expect(() =>
      verifyPrivilegedResponseBinding("owned-fixture-secret", token + "x", request, 1001),
    ).toThrow();
  });
});
