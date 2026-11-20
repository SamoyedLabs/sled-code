import type { ProviderAccountStatus } from "./types";
import type { AppTranslate } from "./text";
export function isApiKeyAccount(accountId: string) {
  return accountId === "a0000000000000001";
}
export function providerAccountName(
  t: AppTranslate,
  accounts: readonly Pick<ProviderAccountStatus, "id" | "label" | "email">[],
  accountId: string,
): string {
  const index = Math.max(
    0,
    accounts.findIndex((account) => account.id === accountId),
  );
  const account = accounts[index];
  return (
    account?.label ||
    account?.email ||
    (account && isApiKeyAccount(account.id) ? t("provider.account.apiKey") : null) ||
    t("provider.account.numbered", { number: index + 1 })
  );
}
