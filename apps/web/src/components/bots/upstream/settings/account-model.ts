import * as Schema from "effect/Schema";
const issue = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  retryAfterSeconds: Schema.optional(Schema.Number),
  reference: Schema.optional(Schema.String),
});
const state = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["loading", "signed_out", "signing_in"]) }),
  Schema.Struct({
    status: Schema.Literal("code_sent"),
    challengeId: Schema.String,
    email: Schema.String,
    expiresAt: Schema.Number,
    resendAvailableAt: Schema.Number,
    issue: Schema.optional(issue),
  }),
  Schema.Struct({
    status: Schema.Literal("company_sign_in"),
    email: Schema.String,
    issue: Schema.optional(issue),
  }),
  Schema.Struct({
    status: Schema.Literal("signed_in"),
    user: Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      name: Schema.NullOr(Schema.String),
      avatarUrl: Schema.NullOr(Schema.String),
    }),
  }),
  Schema.Struct({ status: Schema.Literal("error"), issue }),
]);
export const decodeHostAccount = Schema.decodeUnknownSync(
  Schema.Struct({
    state,
    flow: Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        expiresAt: Schema.Number,
        authorizeUrl: Schema.NullOr(Schema.String),
        callback: Schema.NullOr(
          Schema.Struct({ port: Schema.Number, path: Schema.String, state: Schema.String }),
        ),
      }),
    ),
  }),
);
export type HostAccountView = ReturnType<typeof decodeHostAccount>;
export type HostAccountState = HostAccountView["state"];
export const ONE_TIME_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function normalizeAccountCode(value: string) {
  const result = value.toUpperCase().replace(/[\s-]/gu, "");
  return result.length === 8 && [...result].every((c) => ONE_TIME_CODE_ALPHABET.includes(c))
    ? result
    : null;
}
export function normalizeAccountEmail(value: string) {
  const result = value.trim().toLowerCase(),
    parts = result.split("@");
  if (
    result.length > 320 ||
    parts.length !== 2 ||
    !parts[0] ||
    parts[0].length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(parts[0]) ||
    !parts[1] ||
    parts[1].length > 253 ||
    !parts[1].includes(".") ||
    !parts[1]
      .split(".")
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
      )
  )
    return null;
  return result;
}
export function accountCallbackQuery(
  address: string,
  callback: { port: number; path: string; state: string },
): string | null {
  try {
    const url = new URL(address.trim()),
      query = url.searchParams;
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      Number(url.port) !== callback.port ||
      url.pathname !== "/company-sign-in" ||
      url.pathname !== callback.path ||
      url.username ||
      url.password ||
      url.hash ||
      query.get("state") !== callback.state ||
      Boolean(query.get("code")) === Boolean(query.get("error"))
    )
      return null;
    const allowed = new Set(["state", "code", "error", "error_description"]);
    if ([...query.keys()].some((key) => !allowed.has(key) || query.getAll(key).length !== 1))
      return null;
    return url.search.slice(1);
  } catch {
    return null;
  }
}
