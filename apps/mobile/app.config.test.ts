import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { resolveMobileStageLabel, usesDarkMobileMascot } from "./src/lib/mobileBranding";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () =>
    Object.fromEntries(
      [
        "APP_VARIANT",
        "T3CODE_MOBILE_UPDATES_ENABLED",
        "SLED_EXPO_PROJECT_ID",
        "SLED_EXPO_OWNER",
        "SLED_EXPO_CHANNEL",
        "T3CODE_IOS_PERSONAL_TEAM",
        "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID",
      ]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
}));

beforeEach(() => {
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", undefined);
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID", undefined);
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", undefined);
  vi.stubEnv("SLED_EXPO_PROJECT_ID", undefined);
  vi.stubEnv("SLED_EXPO_OWNER", undefined);
  vi.stubEnv("SLED_EXPO_CHANNEL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.samoyedlabs.sled", "Beta", "startup"],
  ["development", "com.samoyedlabs.sled.dev", "Dev", "startup-dev"],
  ["preview", "com.samoyedlabs.sled.preview", "Nightly", "startup"],
  ["production", "com.samoyedlabs.sled", "Beta", "startup"],
])(
  "keeps identifiers and stage branding for APP_VARIANT=%j",
  async (value, identifier, stage, assets) => {
    const config = await loadConfig(value);
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.android?.package).toBe(identifier);
    expect(resolveMobileStageLabel(config.extra?.appVariant)).toBe(stage);
    expect(usesDarkMobileMascot(config.extra?.appVariant)).toBe(assets === "startup-dev");
    expect(config.plugins).toContainEqual([
      "expo-splash-screen",
      expect.objectContaining({
        image: `../../assets/branding/${assets}/rest.png`,
        android: expect.objectContaining({
          image: `../../assets/branding/${assets}/android-rest.png`,
        }),
      }),
    ]);
  },
);

it("disables OTA updates without inheriting upstream Expo ownership", async () => {
  const config = await loadConfig("production");
  expect(config.updates?.enabled).toBe(false);
  expect(config.updates?.url).toBeUndefined();
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas.projectId).toBeUndefined();
});

it("requires an explicitly configured project and owner to enable OTA updates", async () => {
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "1");
  await expect(loadConfig("production")).rejects.toThrow(
    "OTA updates require SLED_EXPO_PROJECT_ID and SLED_EXPO_OWNER",
  );
});

it.each(["d763fcb8-d37c-41ea-a773-b54a0ab4a454", "D763FCB8-D37C-41EA-A773-B54A0AB4A454"])(
  "rejects the upstream T3 Expo project %s",
  async (project) => {
    vi.stubEnv("SLED_EXPO_PROJECT_ID", project);
    await expect(loadConfig("production")).rejects.toThrow("Sled must use its own Expo project");
  },
);

it("enables OTA updates for an explicitly configured independent project", async () => {
  vi.stubEnv("SLED_EXPO_PROJECT_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("SLED_EXPO_OWNER", "samoyedlabs");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "1");
  const config = await loadConfig("production");
  expect(config.updates?.enabled).toBe(true);
  expect(config.slug).toBe("sled-code");
  expect(config.updates?.url).toBe("https://u.expo.dev/11111111-1111-4111-8111-111111111111");
  expect(config.owner).toBe("samoyedlabs");
  expect(config.updates?.requestHeaders).toEqual({ "expo-channel-name": "production" });
  vi.stubEnv("SLED_EXPO_CHANNEL", "sled-private");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID", "com.samoyedlabs.sled");
  const privateConfig = await loadConfig("preview");
  expect(privateConfig.name).toBe("Sled");
  expect(privateConfig.scheme).toBe("sled");
  expect(privateConfig.ios?.bundleIdentifier).toBe("com.samoyedlabs.sled");
  expect(privateConfig.extra?.appVariant).toBe("preview");
  expect(resolveMobileStageLabel(privateConfig.extra?.appVariant)).toBe("Nightly");
  expect(privateConfig.updates?.requestHeaders).toEqual({ "expo-channel-name": "sled-private" });
});
