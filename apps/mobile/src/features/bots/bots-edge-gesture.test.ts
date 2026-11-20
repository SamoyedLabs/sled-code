import { describe, expect, it } from "vite-plus/test";
import { BOTS_SCREEN_EDGE_WIDTH, shouldOpenBots } from "./bots-edge-gesture";

describe("Code to Bots edge navigation", () => {
  it("accepts natural diagonal edge swipes and short rightward flicks", () => {
    expect(shouldOpenBots("Home", 220, 65)).toBe(true);
    expect(shouldOpenBots("Thread", 180, -60)).toBe(true);
    expect(shouldOpenBots("Thread", 92, 67)).toBe(true);
    expect(shouldOpenBots("Home", 38, 8, 800)).toBe(true);
    expect(shouldOpenBots("Home", 38, 8, 100)).toBe(false);
    expect(shouldOpenBots("Home", 10, 2, 1000)).toBe(false);
    expect(shouldOpenBots("Thread", 45, 90, 800)).toBe(false);
  });
  it("allows a thumb-width start area while leaving interior row swipes alone", () => {
    expect(BOTS_SCREEN_EDGE_WIDTH).toBeGreaterThanOrEqual(44);
    expect(BOTS_SCREEN_EDGE_WIDTH).toBeLessThan(100);
  });
  it("commits rightward root gestures and leaves nested navigation alone", () => {
    for (const route of ["Home", "Thread"]) {
      expect(shouldOpenBots(route, 64, 0)).toBe(true);
      expect(shouldOpenBots(route, -100, 0)).toBe(false);
      expect(shouldOpenBots(route, 30, 0)).toBe(false);
      expect(shouldOpenBots(route, 100, 150)).toBe(false);
    }
    for (const route of [
      "Bots",
      "Settings",
      "SettingsBotDetail",
      "NewTaskProject",
      "ThreadFiles",
    ]) {
      expect(shouldOpenBots(route, 100, 0)).toBe(false);
    }
  });
});
