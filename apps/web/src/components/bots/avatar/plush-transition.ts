import { BotEngine, STATE_BY_ID } from "./vendor/bloub-engine";

const shrinkDuration = BotEngine.SHAPE_MORPH / 2;
const notify = STATE_BY_ID.get("notify")!;
const radius = (time: number) => notify.pose(time).notif?.r ?? 0;
const settledRadius = radius(10);
const springDuration = (() => {
  for (let millisecond = 1; millisecond < 5000; millisecond++) {
    if (
      radius(millisecond / 1000) === settledRadius &&
      radius((millisecond - 1) / 1000) !== settledRadius
    )
      return millisecond / 1000;
  }
  return BotEngine.SHAPE_MORPH;
})();
export const POP_DURATION = shrinkDuration + springDuration;

// PlushBot transition.ts: shrink the old body, then use the notify spring for the new body.
export function plushPop(time: number) {
  if (time >= POP_DURATION) return { scale: 1, switched: true, finished: true };
  if (time < shrinkDuration) {
    const t = Math.max(0, time / shrinkDuration);
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    return { scale: 1 - ease, switched: false, finished: false };
  }
  const t = time - shrinkDuration;
  const ease = 1 - (1 - Math.min(1, t / springDuration)) ** 5;
  return { scale: (ease * radius(t)) / settledRadius, switched: true, finished: false };
}
