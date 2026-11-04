import { describe, expect, it } from "vite-plus/test";
import { decodeBrowserViewInput } from "@t3tools/contracts";
import { browserTextInput } from "./botBrowserInput";

describe("native browser text entry", () => {
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
