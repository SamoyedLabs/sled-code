import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl, LEGAL_URL } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it("opens Sled's published policy and does not embed the upstream policy", () => {
    expect(LEGAL_URL).toBe("https://app.samoyedlabs.com/privacy-policy");
    expect(isLegalDocumentUrl(LEGAL_URL)).toBe(true);
    expect(isLegalDocumentUrl("https://t3.codes/privacy-policy")).toBe(false);
  });
  it.each(["https://example.com/legal", "javascript:alert(1)"])(
    "rejects a URL outside the legal-document allowlist: %s",
    (url) => {
      expect(isLegalDocumentUrl(url)).toBe(false);
    },
  );
});
