import { expect, it } from "@effect/vitest";
import { computerReadiness, computerCapabilities, computerSetup } from "./computer.ts";
it("never treats runtime availability alone as permission to control the computer", () => {
  expect(computerReadiness(null, null)).toBe("Check host capabilities first.");
  const caps = computerCapabilities({
    ready: true,
    platform: "darwin",
    unattended: false,
    runtime: "sunshine-moonlight",
    protocolVersion: 2,
    displays: [],
    selectedDisplayId: null,
    activeSessions: 0,
    maxSessions: 4,
  });
  expect(computerReadiness(caps, null)).toBe("Check host setup before connecting.");
  const setup = computerSetup({
    platform: "darwin",
    hostName: "h",
    username: "u",
    checkedAt: null,
    screenRecording: "allowed",
    accessibility: "blocked",
    service: "allowed",
    displays: "allowed",
    guiSession: "allowed",
    restartRequired: false,
    activeSessions: 0,
    message: null,
  });
  expect(computerReadiness(caps, setup)).toContain("Accessibility: blocked");
  expect(computerCapabilities({ ready: true })).toBeNull();
});
it("rejects invalid check timestamps instead of accepting a date-shaped prefix", () => {
  expect(
    computerSetup({
      platform: "darwin",
      hostName: "h",
      username: "u",
      checkedAt: "2026-99-99Tbad",
      screenRecording: "allowed",
      accessibility: "allowed",
      service: "allowed",
      displays: "allowed",
      guiSession: "allowed",
      restartRequired: false,
      activeSessions: 0,
      message: null,
    }),
  ).toBeNull();
});
