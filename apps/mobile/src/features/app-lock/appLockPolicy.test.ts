import { expect, it } from "vite-plus/test";
import { nextAppPinAttempt, requiresAppRelock } from "./appLockPolicy";

it("relocks for a protected-data event or elapsed idle time while honoring the phone-lock preference", () => {
  expect(
    requiresAppRelock({ delay: 60_000, lockWithPhone: true }, { awayMs: 3_000, phoneLocked: true }),
  ).toBe(true);
  expect(
    requiresAppRelock(
      { delay: 60_000, lockWithPhone: false },
      { awayMs: 3_000, phoneLocked: true },
    ),
  ).toBe(false);
  expect(
    requiresAppRelock(
      { delay: 60_000, lockWithPhone: false },
      { awayMs: 60_000, phoneLocked: false },
    ),
  ).toBe(true);
  expect(
    requiresAppRelock({ delay: 60_000, lockWithPhone: false }, { awayMs: -1, phoneLocked: false }),
  ).toBe(true);
});

it("applies PIN cooldowns from the fifth failed attempt and refuses clock backdating", () => {
  expect(nextAppPinAttempt({ count: 4, last: 1_000 }, 1_000)).toBe(1_000);
  expect(nextAppPinAttempt({ count: 5, last: 1_000 }, 1_000)).toBe(31_000);
  expect(nextAppPinAttempt({ count: 5, last: 1_000 }, 31_001)).toBe(31_001);
  expect(nextAppPinAttempt({ count: 5, last: 20_000 }, 1_000)).toBe(31_000);
  expect(nextAppPinAttempt({ count: 20, last: 1_000 }, 1_000)).toBe(3_601_000);
});
