import * as Schema from "effect/Schema";
import {
  OpenbotVaultSave,
  type OpenbotVaultItem,
  type OpenbotVaultRequest,
} from "@t3tools/contracts";
const decodeVaultSave = Schema.decodeUnknownSync(OpenbotVaultSave);
export type VaultExecute = (
  request: OpenbotVaultRequest,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
export type VaultKind = OpenbotVaultItem["kind"];
export const vaultFields = {
  login: ["website", "username", "notes"],
  card: ["label", "nameOnCard", "expMonth", "expYear", "billingContactId", "fillSites"],
  contact: [
    "label",
    "fullName",
    "address",
    "address2",
    "city",
    "region",
    "postalCode",
    "country",
    "phone",
    "email",
  ],
  apiKey: ["name", "notes"],
} as const;
export const vaultPrivateFields = {
  login: ["password"],
  card: ["number", "securityCode"],
  contact: [],
  apiKey: ["key"],
} as const;
export function vaultSecretFields(item: OpenbotVaultItem) {
  return vaultPrivateFields[item.kind];
}
export function vaultDraft(item: OpenbotVaultItem | null): Record<string, string> {
  if (!item) return {};
  return Object.fromEntries(
    vaultFields[item.kind].map((key) => {
      const value = Reflect.get(item, key);
      return [key, Array.isArray(value) ? value.join("\n") : value == null ? "" : String(value)];
    }),
  );
}
export function vaultLabel(item: OpenbotVaultItem) {
  return item.kind === "login"
    ? `${item.website} (${item.username})`
    : item.kind === "apiKey"
      ? item.name
      : item.label || (item.kind === "contact" ? item.fullName : item.last4);
}
export function vaultSave(
  kind: VaultKind,
  id: string | null,
  fields: Record<string, string>,
  secrets: Record<string, string>,
): OpenbotVaultSave {
  const values: Record<string, unknown> = { kind, id };
  for (const key of vaultFields[kind]) values[key] = fields[key] ?? "";
  if (kind === "card") {
    values.expMonth = Number(fields.expMonth);
    values.expYear = Number(fields.expYear);
    values.billingContactId = fields.billingContactId || null;
    values.fillSites = (fields.fillSites || "").split("\n").filter(Boolean);
  }
  for (const key of vaultPrivateFields[kind]) values[key] = secrets[key] || null;
  return decodeVaultSave(values);
}
export function vaultSaveRequest(
  kind: VaultKind,
  id: string | null,
  fields: Record<string, string>,
  secrets: Record<string, string>,
  version: "v1" | "v2",
): OpenbotVaultRequest | null {
  try {
    const input = vaultSave(kind, id, fields, secrets);
    if (version === "v1")
      return input.kind === "apiKey" ? null : { operation: "vault.save", version, input };
    return { operation: "vault.save", version, input };
  } catch {
    return null;
  }
}
