import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { AuthDesktopOperateScope, AuthStandardClientScopes, sessionGrantsScope } from "./auth.ts";
import { RemoteDesktopStartInput, RemoteDesktopRestartInput } from "./remoteDesktop.ts";

const input = {
  clientNonce: "10000000-0000-4000-8000-000000000001",
  clientFingerprint: "A".repeat(43),
  hostFingerprint: "B".repeat(43),
  offer: "v=0\r\n",
};
const decode = Schema.decodeUnknownSync(RemoteDesktopStartInput);
const decodeRestart = Schema.decodeUnknownSync(RemoteDesktopRestartInput);
describe("remote desktop signaling boundaries", () => {
  it("does not inherit desktop control from legacy or standard client grants", () => {
    expect(AuthStandardClientScopes).not.toContain(AuthDesktopOperateScope);
    expect(
      sessionGrantsScope(
        { authenticated: true, scopes: AuthStandardClientScopes },
        AuthDesktopOperateScope,
      ),
    ).toBe(false);
    expect(
      sessionGrantsScope(
        { authenticated: true, permissions: [AuthDesktopOperateScope] },
        AuthDesktopOperateScope,
      ),
    ).toBe(true);
  });
  it("strips client-supplied native lease deadlines", () => {
    expect(decode({ ...input, expiresAt: 9999999999999 })).toEqual(input);
    expect(
      decodeRestart({
        sessionId: input.clientNonce,
        offer: input.offer,
        hostFingerprint: "C".repeat(43),
        clientNonce: input.clientNonce,
        connectivity: { apiToken: "never-forward-this" },
        expiresAt: 9999999999999,
      }),
    ).toEqual({ sessionId: input.clientNonce, offer: input.offer });
  });
  it("bounds descriptions by bytes and ICE candidates", () => {
    expect(() => decode({ ...input, offer: "v=0\r\n" + "x".repeat(65_536) })).toThrow();
    expect(() => decode({ ...input, offer: "v=0\r\ns=\u{1f600}\r\n" })).toThrow();
    expect(() =>
      decode({ ...input, offer: "v=0\r\n" + "a=candidate:fixture\r\n".repeat(65) }),
    ).toThrow();
    expect(
      decode({ ...input, offer: "v=0\r\n" + "a=candidate:fixture\r\n".repeat(64) }).offer,
    ).toContain("a=candidate:");
  });
  it("rejects malformed identities and session nonces", () => {
    for (const override of [
      { hostFingerprint: "bad" },
      { clientFingerprint: "=".repeat(43) },
      { clientNonce: "reused" },
    ]) {
      expect(() => decode({ ...input, ...override })).toThrow();
    }
  });
});
