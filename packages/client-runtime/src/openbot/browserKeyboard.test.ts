import { expect, it } from "vite-plus/test";
import { BrowserKeyboard } from "./browserKeyboard.ts";

it("releases held remote keys on focus loss without replaying released keys or text", () => {
  const keys = new BrowserKeyboard();
  expect(keys.down({ key: "Control", code: "ControlLeft", modifiers: 2 })).toEqual([
    { type: "key", action: "down", key: "Control", code: "ControlLeft", modifiers: 2, text: "" },
  ]);
  expect(keys.down({ key: "a", code: "KeyA", modifiers: 2 })).toHaveLength(1);
  keys.up({ key: "a", code: "KeyA", modifiers: 2 });
  keys.down({ key: "ArrowDown", code: "ArrowDown", modifiers: 2 });
  expect(keys.release()).toEqual([
    { type: "key", action: "up", key: "Control", code: "ControlLeft", modifiers: 0, text: "" },
    { type: "key", action: "up", key: "ArrowDown", code: "ArrowDown", modifiers: 0, text: "" },
  ]);
  expect(keys.release()).toEqual([]);
  expect(keys.up({ key: "Control", code: "ControlLeft", modifiers: 0 })).toEqual([]);
  expect(keys.down({ key: "b", code: "KeyB", modifiers: 0 })).toEqual([
    { type: "key", action: "down", key: "b", code: "KeyB", modifiers: 0, text: "" },
    { type: "key", action: "char", key: "b", code: "KeyB", modifiers: 0, text: "b" },
  ]);
  expect(keys.release()).toHaveLength(1);
});
