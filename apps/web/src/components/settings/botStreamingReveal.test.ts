import { describe, expect, it } from "vite-plus/test";
import { nextBotStreamingReveal } from "./botStreamingReveal";

const timing = { stepMs: 40, catchUpMs: 400 };

describe("OpenBot streaming text projection", () => {
  it("waits for an incomplete word, then flushes it when streaming ends", () => {
    const partial = { shownLength: 0, target: "unfinished", streaming: true, budget: 0, ...timing };
    expect(nextBotStreamingReveal(partial)).toEqual({ length: 0, budget: 0 });
    expect(nextBotStreamingReveal({ ...partial, streaming: false })).toEqual({
      length: 10,
      budget: 0,
    });
  });

  it("reveals markdown list markers together with their first word", () => {
    const step = nextBotStreamingReveal({
      shownLength: 0,
      target: "1. Hello world",
      streaming: true,
      budget: 0,
      ...timing,
    });
    expect("1. Hello world".slice(0, step.length)).toBe("1. Hello ");
  });

  it("caps a long URL's debt so the next words cannot stall", () => {
    const url = `https://example.com/${"a".repeat(300)} `;
    const step = nextBotStreamingReveal({
      shownLength: 0,
      target: `${url}next word `,
      streaming: true,
      budget: 0,
      ...timing,
    });
    expect(step.length).toBe(url.length);
    expect(step.budget).toBe(-4.8);
    const next = nextBotStreamingReveal({
      shownLength: step.length,
      target: `${url}next word `,
      streaming: true,
      budget: step.budget,
      ...timing,
    });
    expect(next.length).toBeGreaterThan(step.length);
  });

  it("drains a completed reply without duplicating or dropping text", () => {
    const target = "A complete reply with markdown **and emphasis** and a final word";
    let state = { length: 0, budget: 0 };
    for (let step = 0; step < target.length; step += 1) {
      state = nextBotStreamingReveal({
        shownLength: state.length,
        target,
        streaming: false,
        budget: state.budget,
        ...timing,
      });
      if (state.length === target.length) break;
    }
    expect(state).toEqual({ length: target.length, budget: 0 });
  });
});
