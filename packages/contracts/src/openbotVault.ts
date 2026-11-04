import * as Schema from "effect/Schema";
const text = Schema.String.check(Schema.isMaxLength(512));
const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const notes = Schema.String.check(Schema.isMaxLength(4096));
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const month = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }));
const contact = {
  label: text,
  fullName: text,
  address: text,
  address2: text,
  city: text,
  region: text,
  postalCode: text,
  country: text,
  phone: text,
  email: text,
};
const origin = { addedBy: Schema.optional(text) };
const login = { website: text, username: text, notes };
const card = {
  label: text,
  nameOnCard: text,
  expMonth: month,
  expYear: count,
  billingContactId: Schema.NullOr(id),
};
const sites = Schema.Array(text).check(Schema.isMaxLength(100));
const keyName = Schema.String.check(Schema.isMaxLength(64));
const LoginSave = Schema.Struct({
  kind: Schema.Literal("login"),
  id: Schema.NullOr(id),
  ...login,
  password: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
});
const CardSave = Schema.Struct({
  kind: Schema.Literal("card"),
  id: Schema.NullOr(id),
  ...card,
  number: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
  securityCode: Schema.NullOr(Schema.String.check(Schema.isMaxLength(8))),
  fillSites: Schema.optional(sites),
});
const ContactSave = Schema.Struct({
  kind: Schema.Literal("contact"),
  id: Schema.NullOr(id),
  ...contact,
});
const KeySave = Schema.Struct({
  kind: Schema.Literal("apiKey"),
  id: Schema.NullOr(id),
  name: keyName,
  notes,
  key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(8192))),
});
export const OpenbotVaultSave = Schema.Union([LoginSave, CardSave, ContactSave, KeySave]);
export type OpenbotVaultSave = typeof OpenbotVaultSave.Type;
export const OpenbotVaultItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("login"),
    id,
    ...login,
    hasPassword: Schema.Boolean,
    ...origin,
  }),
  Schema.Struct({
    kind: Schema.Literal("card"),
    id,
    ...card,
    brand: Schema.NullOr(Schema.Literals(["visa", "mastercard", "amex", "discover"])),
    last4: Schema.String.check(Schema.isMaxLength(4)),
    fillSites: sites,
    ...origin,
  }),
  Schema.Struct({ kind: Schema.Literal("contact"), id, ...contact, ...origin }),
  Schema.Struct({
    kind: Schema.Literal("apiKey"),
    id,
    name: keyName,
    notes,
    hasKey: Schema.Boolean,
    ...origin,
  }),
]);
export type OpenbotVaultItem = typeof OpenbotVaultItem.Type;
export const OpenbotVaultState = Schema.Struct({
  status: Schema.Literals(["ready", "unavailable", "unreadable"]),
  items: Schema.Array(OpenbotVaultItem).check(Schema.isMaxLength(5000)),
});
export type OpenbotVaultState = typeof OpenbotVaultState.Type;
export const OpenbotVaultImportResult = Schema.Struct({ imported: count, skipped: count });
export const OpenbotVaultSecret = Schema.Struct({
  value: Schema.String.check(Schema.isMaxLength(8192)),
});
export const OpenbotVaultOnePasswordStatus = Schema.Struct({
  state: Schema.String.check(Schema.isMaxLength(64)),
  vaultNames: Schema.Array(Schema.String.check(Schema.isMaxLength(1024))).check(
    Schema.isMaxLength(500),
  ),
  loginCount: Schema.NullOr(count),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
});
export const OpenbotVaultBitwardenStatus = Schema.Struct({
  state: Schema.String.check(Schema.isMaxLength(64)),
  serverUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
});
const version = Schema.Literals(["v1", "v2"]);
export const OpenbotVaultRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literals(["vault.list", "vault.reset"]), version }),
  Schema.Struct({ operation: Schema.Literal("vault.delete"), version, id }),
  Schema.Struct({
    operation: Schema.Literal("vault.save"),
    version: Schema.Literal("v1"),
    input: Schema.Union([LoginSave, CardSave, ContactSave]),
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.save"),
    version: Schema.Literal("v2"),
    input: OpenbotVaultSave,
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.reveal"),
    version: Schema.Literal("v1"),
    id,
    field: Schema.Literals(["password", "number", "securityCode"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.reveal"),
    version: Schema.Literal("v2"),
    id,
    field: Schema.Literals(["password", "number", "securityCode", "key"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.import"),
    csv: Schema.String.check(Schema.isMaxLength(262144)),
  }),
  Schema.Struct({
    operation: Schema.Literals([
      "vault.onepassword.status",
      "vault.onepassword.disconnect",
      "vault.bitwarden.status",
      "vault.bitwarden.disconnect",
    ]),
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.onepassword.connect"),
    token: Schema.String.check(Schema.isMaxLength(4096)),
  }),
  Schema.Struct({
    operation: Schema.Literal("vault.bitwarden.connect"),
    serverUrl: Schema.String.check(Schema.isMaxLength(2048)),
    clientId: Schema.String.check(Schema.isMaxLength(256)),
    clientSecret: Schema.String.check(Schema.isMaxLength(256)),
    masterPassword: Schema.String.check(Schema.isMaxLength(1024)),
  }),
]);
export type OpenbotVaultRequest = typeof OpenbotVaultRequest.Type;
