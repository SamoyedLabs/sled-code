// Source-backed host-account-v1; see LICENSE.upstream.
// Closed host-account-v1 bridge: host owners/admins manage the account of this exact host.
// Account credentials, PKCE verifiers and development codes never cross this boundary.
import {
  adminRoute,
  fields,
  string,
  identifier,
  count,
  nullable,
  oneOf,
  empty,
  type AdminDecoder,
  type OptionalRouteCodec,
} from "./admin-wire.ts";
export const HOST_ACCOUNT_CAPABILITY = "host-account-v1";
export const HOST_ACCOUNT_ROUTES = {
  status: "/v1/admin/account/status",
  emailStart: "/v1/admin/account/email/start",
  emailVerify: "/v1/admin/account/email/verify",
  retry: "/v1/admin/account/retry",
  logout: "/v1/admin/account/logout",
  companyOpen: "/v1/admin/account/company/open",
  companyComplete: "/v1/admin/account/company/complete",
  cancel: "/v1/admin/account/cancel",
} as const;
const issue = fields(
  { code: string(128), message: string(4096) },
  { retryAfterSeconds: count, reference: string(256) },
);
const user = fields({
  id: identifier,
  email: string(320),
  name: nullable(string(256)),
  avatarUrl: nullable(string(2048)),
});
const states: Record<string, AdminDecoder> = {
  loading: fields({ status: oneOf("loading") }),
  signed_out: fields({ status: oneOf("signed_out") }),
  signing_in: fields({ status: oneOf("signing_in") }),
  code_sent: fields(
    {
      status: oneOf("code_sent"),
      challengeId: identifier,
      email: string(320),
      expiresAt: count,
      resendAvailableAt: count,
    },
    { issue },
  ),
  company_sign_in: fields({ status: oneOf("company_sign_in"), email: string(320) }, { issue }),
  signed_in: fields({ status: oneOf("signed_in"), user }),
  error: fields({ status: oneOf("error"), issue }),
};
const state: AdminDecoder = (value) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("status" in value) ||
    typeof value.status !== "string" ||
    !Object.hasOwn(states, value.status)
  )
    throw new Error("Invalid account state.");
  return states[value.status]!(value);
};
const port: AdminDecoder = (value) => {
  const n = count(value);
  if (typeof n !== "number" || n < 1 || n > 65535) throw new Error("Invalid callback port.");
  return n;
};
const authorizeUrl: AdminDecoder = (value) => {
  const raw = string(8192)(value);
  if (typeof raw !== "string") throw new Error("Invalid authorization URL.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid authorization URL.");
  return raw;
};
const callback = fields({
  port,
  path: oneOf("/company-sign-in"),
  state: string(256),
});
const flow = fields({
  id: identifier,
  expiresAt: count,
  authorizeUrl: nullable(authorizeUrl),
  callback: nullable(callback),
});
const view = fields({ state, flow: nullable(flow) });
export const HOST_ACCOUNT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_ACCOUNT_ROUTES.status, adminRoute(empty, view)],
  [HOST_ACCOUNT_ROUTES.emailStart, adminRoute(fields({ email: string(320) }), view)],
  [
    HOST_ACCOUNT_ROUTES.emailVerify,
    adminRoute(
      fields({
        flowId: identifier,
        challengeId: identifier,
        code: string(32),
      }),
      view,
    ),
  ],
  [HOST_ACCOUNT_ROUTES.retry, adminRoute(empty, view)],
  [HOST_ACCOUNT_ROUTES.logout, adminRoute(empty, view)],
  [HOST_ACCOUNT_ROUTES.companyOpen, adminRoute(fields({ flowId: identifier }), view)],
  [
    HOST_ACCOUNT_ROUTES.companyComplete,
    adminRoute(fields({ flowId: identifier, callbackQuery: string(16384) }), view),
  ],
  [HOST_ACCOUNT_ROUTES.cancel, adminRoute(fields({ flowId: identifier }), view)],
]);
