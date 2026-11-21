import { describe, expect, it } from "vite-plus/test";
import { insertBotDrafts, moveBotDraft, reorderBotDrafts } from "./botComposerAttachmentOrder";
describe("composer attachment identity ordering", () => {
  it("retains picked order when uploads complete in reverse order without disturbing existing selections", () => {
    let selected = insertBotDrafts(["existing"], ["third"]);
    selected = insertBotDrafts(selected, ["second"], "third");
    selected = insertBotDrafts(selected, ["first"], "second");
    expect(selected).toEqual(["existing", "first", "second", "third"]);
    expect(insertBotDrafts(selected, ["first"], "third")).toEqual(selected);
  });
  it("reorders only a permutation of the selected identities", () => {
    const original = ["one", "two", "three"];
    expect(reorderBotDrafts(original, moveBotDraft(original, "one", "three"))).toEqual([
      "two",
      "three",
      "one",
    ]);
    for (const invalid of [
      ["one", "one", "three"],
      ["one", "two"],
      ["one", "two", "outside"],
    ])
      expect(reorderBotDrafts(original, invalid)).toBe(original);
    expect(moveBotDraft(original, "outside", "one")).toBe(original);
  });
  it("keeps the contract's ten attachment limit and ignores an absent insertion anchor", () => {
    const original = Array.from({ length: 9 }, (_, index) => String(index));
    expect(insertBotDrafts(original, ["last", "overflow"], "removed-file")).toEqual([
      ...original,
      "last",
    ]);
  });
});
