import { describe, expect, it } from "vite-plus/test";
import { personalRelayUrl, validatePersonalRelay } from "./sledConnect.ts";

describe("personal Sled relay configuration", () => {
  it("requires an HTTPS origin without credentials or a path", () => {
    expect(personalRelayUrl(" https://relay.example.com/ ")).toBe("https://relay.example.com");
    for (const value of [
      "http://relay.example.com",
      "https://user:password@relay.example.com",
      "https://relay.example.com/path",
      "https://relay.example.com?token=secret",
    ]) {
      expect(() => personalRelayUrl(value)).toThrow();
    }
  });
  it("rejects a relay that uses a different Clerk authority before saving it", async () => {
    const key = `pk_test_${btoa("clerk.example.com$")}`;
    const fetcher: typeof fetch = async () =>
      Response.json({
        protocolVersion: 1,
        relayUrl: "https://relay.example.com",
        clerkIssuer: "https://another.clerk.accounts.dev",
      });
    await expect(validatePersonalRelay("https://relay.example.com", key, fetcher)).rejects.toThrow(
      "not configured",
    );
  });
});
