import { expect, it } from "vite-plus/test";
import {
  codeSignInStatus,
  providerWebConnectRoute,
  codeSignInSupported,
  providerSettingsLabel,
  providerSettingsRows,
  providerUpdateAvailable,
  type ProviderSettingsOption,
} from "./provider-settings-model";
const base: ProviderSettingsOption = {
  id: "codex",
  name: "ChatGPT",
  state: "available",
  version: null,
  message: null,
};
it("keeps connecting providers with connected rows and searches account identity", () => {
  const connecting = {
    ...base,
    state: "sign-in-required",
    connectionState: "connecting" as const,
    accounts: [
      {
        id: "default",
        label: null,
        email: "work@example.test",
        state: "connecting",
        message: null,
      },
    ],
  };
  expect(providerSettingsRows([connecting], "work@example").connected).toEqual([connecting]);
  expect(providerSettingsRows([{ ...base, off: true }], "").other).toHaveLength(1);
});
it("preserves unknown states and reports updates only from the host version offer", () => {
  expect(providerSettingsLabel({ ...base, state: "new-host-state" })).toBe("new-host-state");
  expect(
    providerUpdateAvailable({ phase: "ready", progress: null, message: null, version: "1" }),
  ).toBe(false);
  expect(
    providerUpdateAvailable({
      phase: "ready",
      progress: null,
      message: null,
      version: "1",
      availableVersion: "2",
    }),
  ).toBe(true);
  expect(
    providerUpdateAvailable({
      phase: "downloading",
      progress: 32,
      message: null,
      version: "1",
      availableVersion: "2",
    }),
  ).toBe(false);
});
it("does not infer Claude code sign-in from runtime management capability", () => {
  expect(codeSignInSupported("claude", ["providers-v4", "providers-v8"])).toBe(false);
  expect(codeSignInSupported("claude", ["providers-v3"])).toBe(true);
  expect(codeSignInSupported("future-provider", ["providers-v8"])).toBe(false);
});

it("does not finish a new sign-in from the previously connected account", () => {
  expect(codeSignInStatus(false, { state: "available", message: null }).outcome).toBe(null);
  expect(
    codeSignInStatus(false, { state: "available", message: null, connectionState: "connecting" })
      .started,
  ).toBe(true);
  expect(codeSignInStatus(true, { state: "available", message: null }).outcome).toBe("connected");
  expect(codeSignInStatus(true, { state: "error", message: "Rejected" }).outcome).toBe("failed");
});

it("preserves source web sign-in priority and the manual callback alternative", () => {
  expect(providerWebConnectRoute("codex", ["providers-v1", "sign-in-relay-v1"], false)).toEqual({
    connect: "code",
    alternative: "relay",
  });
  expect(providerWebConnectRoute("antigravity", ["sign-in-relay-v1"], true)).toEqual({
    connect: "host-page",
    alternative: "relay",
  });
  expect(providerWebConnectRoute("antigravity", ["sign-in-relay-v1"], false)).toEqual({
    connect: "use-app",
    alternative: "relay",
  });
  expect(providerWebConnectRoute("muse", ["sign-in-relay-v1"], false)).toEqual({
    connect: "relay",
    alternative: null,
  });
  expect(
    providerWebConnectRoute("future-provider", ["providers-v8", "sign-in-relay-v1"], false),
  ).toEqual({ connect: null, alternative: null });
});
