import { describe, expect, it } from "vite-plus/test";
import { botSharedFilePath } from "./botSharedFileLink";

describe("bot shared-file links", () => {
  it("recognizes host file references without treating web URLs as local files", () => {
    expect(botSharedFilePath("~/OpenBot/Shared/Transfers/a%20b.txt")).toBe(
      "~/OpenBot/Shared/Transfers/a b.txt",
    );
    expect(botSharedFilePath("/Users/owner/OpenBot/Shared/report.pdf")).toBe(
      "/Users/owner/OpenBot/Shared/report.pdf",
    );
    expect(botSharedFilePath("Shared/report.txt")).toBe("Shared/report.txt");
    for (const href of [
      "https://example.com/OpenBot/Shared/report.txt",
      "//example.com/OpenBot/Shared/a",
      "javascript:alert(1)",
      "~/other.txt",
      "~/OpenBot/Shared/%00bad",
      "~/OpenBot/Shared/%bad",
      "~/OpenBot/Shared/../private.txt",
    ])
      expect(botSharedFilePath(href)).toBeNull();
  });
});
