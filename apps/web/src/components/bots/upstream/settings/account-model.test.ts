import { expect, it } from "vite-plus/test";
import { accountCallbackQuery, normalizeAccountCode, normalizeAccountEmail } from "./account-model";
it("retains source email and eight-character code validation", () => {
  expect(normalizeAccountEmail(" User@Example.com ")).toBe("user@example.com");
  expect(normalizeAccountEmail("user@localhost")).toBeNull();
  expect(normalizeAccountCode("2345-abcd")).toBe("2345ABCD");
  expect(normalizeAccountCode("2345-0IOL")).toBeNull();
});
it("accepts only the exact private callback, once the host has captured its state", () => {
  const callback = { port: 45454, path: "/company-sign-in", state: "owned-state" };
  expect(
    accountCallbackQuery(
      "http://127.0.0.1:45454/company-sign-in?state=owned-state&code=example",
      callback,
    ),
  ).toBe("state=owned-state&code=example");
  for (const address of [
    "http://example.com:45454/company-sign-in?state=owned-state&code=x",
    "http://127.0.0.1:45454/other?state=owned-state&code=x",
    "http://127.0.0.1:45454/company-sign-in?state=other&code=x",
    "http://127.0.0.1:45454/company-sign-in?state=owned-state&code=x&code=y",
  ])
    expect(accountCallbackQuery(address, callback)).toBeNull();
});
