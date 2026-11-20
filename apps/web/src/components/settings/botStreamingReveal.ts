/** Port of OpenBot packages/ui/src/features/conversation/streamingReveal.ts. */
const MIN_CHARACTERS_PER_SECOND = 120;
const STREAMING_WORD = /\s*(?:(?:#{1,6}|[-+*>]|\d+[.)])\s+)?\S+\s+/uy;

/** Preserve the source's word boundaries, catch-up budget and incomplete-word pause. */
export function nextBotStreamingReveal(input: {
  shownLength: number;
  target: string;
  streaming: boolean;
  budget: number;
  stepMs: number;
  catchUpMs: number;
}): { length: number; budget: number } {
  const { target, stepMs } = input;
  const backlog = target.length - input.shownLength;
  if (backlog <= 0) return { length: target.length, budget: 0 };
  const minimumStep = (MIN_CHARACTERS_PER_SECOND * stepMs) / 1000;
  let budget = input.budget + (backlog * stepMs) / Math.max(input.catchUpMs, stepMs) + minimumStep;
  let length = input.shownLength;
  while (budget > 0) {
    STREAMING_WORD.lastIndex = length;
    const word = STREAMING_WORD.exec(target);
    if (!word) {
      if (input.streaming) return { length, budget: Math.min(budget, 0) };
      return { length: target.length, budget: 0 };
    }
    length += word[0].length;
    budget -= word[0].length;
  }
  return { length, budget: Math.max(budget, -minimumStep) };
}
