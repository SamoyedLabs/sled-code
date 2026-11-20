import { expect, it } from "vite-plus/test";
import { prependBotHistoryWindow } from "./botHistoryWindow";
it("reaches every page beyond 500 messages with a bounded contiguous window and a retained scroll anchor", () => {
  let anchor = 29,
    older: readonly number[] = [];
  const reached = new Set<number>([anchor]);
  for (let next = 28; next >= 0; next--) {
    const beforeFirst = older.at(-1) ?? anchor;
    const result = prependBotHistoryWindow(anchor, older, next);
    anchor = result.anchor;
    older = result.older;
    const chronological = [...older].reverse().concat(anchor);
    expect(chronological.length).toBeLessThanOrEqual(10);
    expect(chronological).toContain(beforeFirst);
    for (let i = 1; i < chronological.length; i++)
      expect(chronological[i]).toBe(chronological[i - 1]! + 1);
    chronological.forEach((page) => reached.add(page));
  }
  expect([...reached].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 30 }, (_, index) => index),
  );
  expect(older.at(-1)).toBe(0);
});
