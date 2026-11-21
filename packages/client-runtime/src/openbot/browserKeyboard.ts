import type { BrowserViewInput } from "@t3tools/contracts";

type Key = { key: string; code: string; modifiers: number };
export class BrowserKeyboard {
  readonly #held = new Map<string, Key>();
  down(input: Key): readonly BrowserViewInput[] {
    this.#held.set(input.code || input.key, input);
    return [
      { type: "key", action: "down", ...input, text: "" },
      ...(input.key.length === 1 && !(input.modifiers & 6)
        ? [{ type: "key" as const, action: "char" as const, ...input, text: input.key }]
        : []),
    ];
  }
  up(input: Key): readonly BrowserViewInput[] {
    if (!this.#held.delete(input.code || input.key)) return [];
    return [{ type: "key", action: "up", ...input, text: "" }];
  }
  release(): readonly BrowserViewInput[] {
    const inputs = [...this.#held.values()];
    this.#held.clear();
    return inputs.map((input) => ({
      type: "key",
      action: "up",
      ...input,
      modifiers: 0,
      text: "",
    }));
  }
}
