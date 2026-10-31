import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () =>
    Object.fromEntries(
      ["APP_VARIANT", "T3CODE_MOBILE_UPDATES_ENABLED", "SLED_EXPO_PROJECT_ID", "SLED_EXPO_OWNER"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
}));

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
  [undefined, "com.samoyedlabs.sled"],
  ["development", "com.samoyedlabs.sled.dev"],
  ["preview", "com.samoyedlabs.sled.preview"],
  ["production", "com.samoyedlabs.sled"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
});

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

it("rejects the upstream T3 Expo project", async () => {
  vi.stubEnv("SLED_EXPO_PROJECT_ID", "d763fcb8-d37c-41ea-a773-b54a0ab4a454");
  await expect(loadConfig("production")).rejects.toThrow("Sled must use its own Expo project");
});

it("enables OTA updates for an explicitly configured independent project", async () => {
  vi.stubEnv("SLED_EXPO_PROJECT_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("SLED_EXPO_OWNER", "samoyedlabs");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "1");
  const config = await loadConfig("production");
  expect(config.updates?.enabled).toBe(true);
  expect(config.updates?.url).toBe("https://u.expo.dev/11111111-1111-4111-8111-111111111111");
  expect(config.owner).toBe("samoyedlabs");
});
