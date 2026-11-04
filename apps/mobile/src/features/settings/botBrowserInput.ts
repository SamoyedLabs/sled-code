import type { BrowserViewInput } from "@t3tools/contracts";

export function browserTextInput(text: string): readonly BrowserViewInput[] {
  if (text.length > 64) throw new Error("Send at most 64 characters at a time.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw new Error("This text contains an unsupported control character.");
  const inputs: BrowserViewInput[] = [];
  for (const character of text.replace(/\r\n?/g, "\n")) {
    if (character === "\n" || character === "\t") {
      const key = character === "\n" ? "Enter" : "Tab";
      inputs.push(
        { type: "key", action: "down", key, code: key, text: "", modifiers: 0 },
        { type: "key", action: "up", key, code: key, text: "", modifiers: 0 },
      );
    } else
      inputs.push({
        type: "key",
        action: "char",
        key: character,
        code: "",
        text: character,
        modifiers: 0,
      });
  }
  if (new TextEncoder().encode(inputs.map((input) => JSON.stringify(input)).join("")).length > 6144)
    throw new Error("This text batch is too large. Send a shorter section.");
  return inputs;
}
