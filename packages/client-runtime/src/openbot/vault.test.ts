import { expect, it } from "vite-plus/test";
import { vaultDraft, vaultSave, vaultSecretFields, vaultSaveRequest } from "./vault.ts";
it("preserves card sites and nulls blank replacement secrets", () => {
  const card = {
    kind: "card" as const,
    id: "c",
    label: "Card",
    nameOnCard: "A",
    expMonth: 4,
    expYear: 2030,
    billingContactId: null,
    fillSites: ["https://example.com"],
    brand: null,
    last4: "1234",
  };
  const draft = vaultDraft(card);
  expect(vaultSave("card", "c", draft, {})).toMatchObject({
    fillSites: ["https://example.com"],
    number: null,
    securityCode: null,
  });
  expect(vaultSecretFields(card)).toEqual(["number", "securityCode"]);
});
it("refuses v1 API key saves and preserves secret spacing", () => {
  expect(
    vaultSaveRequest("apiKey", null, { name: "TOKEN", notes: "" }, { key: "secret" }, "v1"),
  ).toBeNull();
  expect(
    vaultSaveRequest(
      "login",
      null,
      { website: "https://example.com", username: "a", notes: "" },
      { password: "  private  " },
      "v2",
    ),
  ).toMatchObject({ input: { password: "  private  " } });
});
