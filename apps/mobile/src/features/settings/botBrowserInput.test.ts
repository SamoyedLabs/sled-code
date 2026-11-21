import { describe, expect, it } from "vite-plus/test";
import { decodeBrowserViewInput } from "@t3tools/contracts";
import { browserTextInput } from "./botBrowserInput";

describe("native browser text entry", () => {
  it("submits a negotiated text insertion as one packet so characters cannot be reordered", () => {
    const text = "native-coherent-input-2322 😀\r\nsecond line";
    const inputs = browserTextInput(text, { clipboard: true });
    expect(inputs.map((input) => decodeBrowserViewInput(JSON.stringify(input)))).toEqual([
      { type: "paste", text: "native-coherent-input-2322 😀\nsecond line" },
    ]);
    expect(browserTextInput("", { clipboard: true })).toEqual([]);
    expect(() => browserTextInput("a".repeat(65), { clipboard: true })).toThrow("64");
  });
  it("preserves Unicode, sends named Enter once and rejects an oversized or control-bearing batch before sending", () => {
    const inputs = browserTextInput("S😀\r\né");
    expect(inputs.map((input) => decodeBrowserViewInput(JSON.stringify(input)))).toEqual([
      { type: "key", action: "char", key: "S", code: "", text: "S", modifiers: 0 },
      { type: "key", action: "char", key: "😀", code: "", text: "😀", modifiers: 0 },
      { type: "key", action: "down", key: "Enter", code: "Enter", text: "", modifiers: 0 },
      { type: "key", action: "up", key: "Enter", code: "Enter", text: "", modifiers: 0 },
      { type: "key", action: "char", key: "e", code: "", text: "e", modifiers: 0 },
      { type: "key", action: "char", key: "́", code: "", text: "́", modifiers: 0 },
    ]);
    expect(() => browserTextInput("a".repeat(65))).toThrow("64");
    expect(() => browserTextInput("a\u0000b")).toThrow("control");
    expect(() => browserTextInput("\n".repeat(64))).toThrow("batch");
    expect(browserTextInput("")).toEqual([]);
  });
});
