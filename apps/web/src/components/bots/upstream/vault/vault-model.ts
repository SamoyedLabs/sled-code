import type { OpenbotVaultItem, OpenbotVaultSave } from "@t3tools/contracts";
export type VaultItemSummary = OpenbotVaultItem;
export type VaultItemKind = OpenbotVaultItem["kind"];
type VaultSaveInput = OpenbotVaultSave;
export type VaultCardSummary = Extract<OpenbotVaultItem, { kind: "card" }>;
export type VaultCardBrand = VaultCardSummary["brand"];
export type VaultContactSummary = Extract<OpenbotVaultItem, { kind: "contact" }>;
export type VaultContactFields = Omit<VaultContactSummary, "id" | "kind" | "addedBy">;
export type VaultSecretField = "password" | "number" | "securityCode" | "key";
type AppTextKey = string;
export const VAULT_TEXT_LIMIT = 512;
/** The approved sites that one card keeps. The oldest goes when a new one is approved. */
export const VAULT_FILL_SITE_LIMIT = 100;
export const VAULT_NOTES_LIMIT = 4096;
export const VAULT_PASSWORD_LIMIT = 1024;
export const VAULT_API_KEY_LIMIT = 8192;
/** An environment variable name, which is also the file name of an API key. */
export const API_KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

/** The countries that the Vault's contact form offers, as ISO 3166-1 alpha-2 codes. */
export const VAULT_COUNTRY_CODES = [
  "AT",
  "AU",
  "BE",
  "CA",
  "CH",
  "DE",
  "DK",
  "ES",
  "FR",
  "GB",
  "IE",
  "IT",
  "JP",
  "NL",
  "PL",
  "SE",
  "US",
] as const;

/** A card's expiry as MM/YY. */
export function vaultExpiryText(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

/** The brand of a card number, from its first digits. */
export function cardBrand(number: string): VaultCardBrand | null {
  if (/^4/u.test(number)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/u.test(number)) return "mastercard";
  if (/^3[47]/u.test(number)) return "amex";
  if (/^(6011|65|64[4-9])/u.test(number)) return "discover";
  return null;
}

type Filter = VaultItemKind | "all";

export const FILTERS = [
  { value: "all", label: "vault.filter.all", empty: "vault.empty" },
  { value: "login", label: "vault.filter.login", empty: "vault.emptyLogin" },
  { value: "card", label: "vault.filter.card", empty: "vault.emptyCard" },
  { value: "contact", label: "vault.filter.contact", empty: "vault.emptyContact" },
  { value: "apiKey", label: "vault.filter.apiKey", empty: "vault.emptyApiKey" },
] as const satisfies readonly { value: Filter; label: AppTextKey; empty: AppTextKey }[];

export const KIND_LABEL = {
  login: "vault.kind.login",
  card: "vault.kind.card",
  contact: "vault.kind.contact",
  apiKey: "vault.kind.apiKey",
} as const satisfies Record<VaultItemKind, AppTextKey>;

export const NEW_TITLE = {
  login: "vault.newLogin",
  card: "vault.newCard",
  contact: "vault.newContact",
  apiKey: "vault.newApiKey",
} as const satisfies Record<VaultItemKind, AppTextKey>;

/** Brand names are not translated. */
export const BRAND_NAME: Record<NonNullable<VaultCardBrand>, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

/** The words in the Visa and Amex marks. They are artwork, so they are not translated. */
export const BRAND_MARK = { visa: "VISA", amex: "AMEX" } as const;

export const SECRET_TEXT = {
  password: { show: "vault.showPassword", hide: "vault.hidePassword", copy: "vault.copyPassword" },
  number: { show: "vault.showNumber", hide: "vault.hideNumber", copy: "vault.copyNumber" },
  securityCode: {
    show: "vault.showSecurityCode",
    hide: "vault.hideSecurityCode",
    copy: "vault.copySecurityCode",
  },
  key: { show: "vault.showKey", hide: "vault.hideKey", copy: "vault.copyKey" },
} as const satisfies Record<
  VaultSecretField,
  { show: AppTextKey; hide: AppTextKey; copy: AppTextKey }
>;

export const digitsOf = (value: string) => value.replace(/\D/gu, "");

/** `MM/YY` or `MM/YYYY`, or null when the text is not a date. */
export function parseExpiry(text: string): { month: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/u.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[1]);
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

type LoginDraft = {
  kind: "login";
  website: string;
  username: string;
  notes: string;
  password: string;
};
type CardDraft = {
  kind: "card";
  label: string;
  nameOnCard: string;
  number: string;
  expiry: string;
  securityCode: string;
  billingContactId: string;
  /** The sites where agents can fill the card with no approval. The user can only remove one. */
  fillSites: string[];
};
type ContactDraft = { kind: "contact" } & VaultContactFields;
type ApiKeyDraft = { kind: "apiKey"; name: string; notes: string; key: string };
export type Draft = LoginDraft | CardDraft | ContactDraft | ApiKeyDraft;

const EMPTY_CONTACT: VaultContactFields = {
  label: "",
  fullName: "",
  address: "",
  address2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
  email: "",
};

/** The secret fields of a saved item start empty: the user reveals or replaces them. */
export function draftOf(kind: VaultItemKind, item: VaultItemSummary | null): Draft {
  if (kind === "login")
    return item?.kind === "login"
      ? { kind, website: item.website, username: item.username, notes: item.notes, password: "" }
      : { kind, website: "", username: "", notes: "", password: "" };
  if (kind === "card")
    return item?.kind === "card"
      ? {
          kind,
          label: item.label,
          nameOnCard: item.nameOnCard,
          number: "",
          expiry: vaultExpiryText(item.expMonth, item.expYear),
          securityCode: "",
          billingContactId: item.billingContactId ?? "",
          fillSites: [...item.fillSites],
        }
      : {
          kind,
          label: "",
          nameOnCard: "",
          number: "",
          expiry: "",
          securityCode: "",
          billingContactId: "",
          fillSites: [],
        };
  if (kind === "apiKey")
    return item?.kind === "apiKey"
      ? { kind, name: item.name, notes: item.notes, key: "" }
      : { kind, name: "", notes: "", key: "" };
  if (item?.kind === "contact") {
    const { id: _id, kind: _kind, ...fields } = item;
    return { kind, ...fields };
  }
  return { kind, ...EMPTY_CONTACT };
}

/** The values that a chat request filled in, over a new item's draft. A secret field is never one of them. */
export function prefilled(draft: Draft, values: Readonly<Record<string, string>>): Draft {
  const value = (key: string, current: string) => values[key] ?? current;
  switch (draft.kind) {
    case "login":
      return {
        ...draft,
        website: value("website", draft.website),
        username: value("username", draft.username),
      };
    case "card":
      return {
        ...draft,
        label: value("label", draft.label),
        nameOnCard: value("nameOnCard", draft.nameOnCard),
        expiry: value("expiry", draft.expiry),
      };
    case "contact":
      return {
        ...draft,
        label: value("label", draft.label),
        fullName: value("fullName", draft.fullName),
        address: value("address", draft.address),
        address2: value("address2", draft.address2),
        city: value("city", draft.city),
        region: value("region", draft.region),
        postalCode: value("postalCode", draft.postalCode),
        country: value("country", draft.country).toUpperCase(),
        phone: value("phone", draft.phone),
        email: value("email", draft.email),
      };
    case "apiKey":
      return draft;
  }
}

/** Whether a draft has the fields that the item needs. A saved secret counts as present. */
export function draftReady(draft: Draft, saved: VaultItemSummary | null): boolean {
  if (draft.kind === "login")
    return Boolean(
      draft.website.trim() && (draft.password || (saved?.kind === "login" && saved.hasPassword)),
    );
  if (draft.kind === "card") {
    const digits = digitsOf(draft.number);
    const numberReady = digits.length >= 12 || (digits.length === 0 && saved?.kind === "card");
    const codeReady = draft.securityCode === "" || /^\d{3,4}$/u.test(draft.securityCode.trim());
    return numberReady && codeReady && parseExpiry(draft.expiry) !== null;
  }
  if (draft.kind === "apiKey")
    return (
      API_KEY_NAME_PATTERN.test(draft.name.trim()) &&
      (draft.key.trim() !== "" || (saved?.kind === "apiKey" && saved.hasKey))
    );
  // The same rule as main: a label alone is not contact info.
  return [draft.fullName, draft.address, draft.phone, draft.email].some(
    (field) => field.trim() !== "",
  );
}

/** An empty secret field keeps the saved value. */
export function saveInput(draft: Draft, id: string | null): VaultSaveInput {
  if (draft.kind === "login")
    return {
      kind: "login",
      id,
      website: draft.website.trim(),
      username: draft.username.trim(),
      notes: draft.notes,
      password: draft.password === "" ? null : draft.password,
    };
  if (draft.kind === "card") {
    const expiry = parseExpiry(draft.expiry) ?? { month: 0, year: 0 };
    const number = digitsOf(draft.number);
    const securityCode = draft.securityCode.trim();
    return {
      kind: "card",
      id,
      label: draft.label.trim(),
      nameOnCard: draft.nameOnCard.trim(),
      expMonth: expiry.month,
      expYear: expiry.year,
      billingContactId: draft.billingContactId || null,
      number: number === "" ? null : number,
      securityCode: securityCode === "" ? null : securityCode,
      fillSites: draft.fillSites,
    };
  }
  if (draft.kind === "apiKey")
    return {
      kind: "apiKey",
      id,
      name: draft.name.trim(),
      notes: draft.notes,
      key: draft.key.trim() === "" ? null : draft.key,
    };
  const { kind: _kind, ...fields } = draft;
  return { kind: "contact", id, ...fields };
}

export function itemMatches(item: VaultItemSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const text =
    item.kind === "login"
      ? [item.website, item.username, item.notes]
      : item.kind === "card"
        ? [item.label, item.nameOnCard, item.last4, item.brand ? BRAND_NAME[item.brand] : ""]
        : item.kind === "apiKey"
          ? [item.name, item.notes]
          : [item.label, item.fullName, item.address, item.city, item.email, item.phone];
  return text.some((value) => value.toLowerCase().includes(needle));
}
