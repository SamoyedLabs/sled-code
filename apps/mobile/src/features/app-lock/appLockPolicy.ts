export const APP_LOCK_DELAYS = [0, 60_000, 300_000, 900_000, 3_600_000] as const;
export type AppLockDelay = (typeof APP_LOCK_DELAYS)[number];

export function requiresAppRelock(
  config: { delay: AppLockDelay; lockWithPhone: boolean },
  away: { awayMs: number | null; phoneLocked: boolean },
) {
  return (
    (away.phoneLocked && config.lockWithPhone) ||
    (away.awayMs !== null && (away.awayMs < 0 || away.awayMs >= config.delay))
  );
}

const ATTEMPT_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;
export function nextAppPinAttempt(attempts: { count: number; last: number }, now: number) {
  if (attempts.count <= 4) return now;
  const delay = ATTEMPT_DELAYS[Math.min(attempts.count - 5, ATTEMPT_DELAYS.length - 1)]!;
  return Math.max(now, (now < attempts.last ? now : attempts.last) + delay);
}
