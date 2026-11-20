// @effect-diagnostics nodeBuiltinImport:off -- shared server/engine authentication boundary.
import * as NodeCrypto from "node:crypto";

export interface PrivilegedResponseBindingRequest {
  readonly principal: string;
  readonly hostId: string;
  readonly environmentId: string;
  readonly method: string;
  readonly path: string;
  readonly bodySha256: string;
}
const domain = "sled-privileged-response-principal-v1\n";
const fail = (): never => {
  throw new Error("Invalid privileged response binding");
};
const signature = (secret: string, payload: string) =>
  NodeCrypto.createHmac("sha256", secret)
    .update(domain + payload)
    .digest();
const validRequest = (request: PrivilegedResponseBindingRequest) =>
  request.principal.length > 0 &&
  request.principal.length <= 256 &&
  request.hostId.length > 0 &&
  request.hostId.length <= 256 &&
  request.method === "POST" &&
  [
    "/v1/sled/privileged-responses/context",
    "/v1/sled/privileged-responses/respond",
    "/v1/sled/privileged-responses/result",
  ].includes(request.path) &&
  request.environmentId.length > 0 &&
  request.environmentId.length <= 256 &&
  /^[a-f0-9]{64}$/.test(request.bodySha256);

/** Called only with the authenticated Sled caller; never accept a caller-supplied principal. */
export function signPrivilegedResponseBinding(
  secret: string,
  request: PrivilegedResponseBindingRequest,
  now: number,
): string {
  if (!secret || !validRequest(request) || !Number.isSafeInteger(now)) return fail();
  const payload = Buffer.from(
    JSON.stringify({ v: 1, ...request, issuedAt: now, expiresAt: now + 30_000 }),
  ).toString("base64url");
  return `${payload}.${signature(secret, payload).toString("base64url")}`;
}

/** A normal upstream member cannot choose a Sled owner by sending an unsigned header. */
export function verifyPrivilegedResponseBinding(
  secret: string,
  token: string,
  expected: Omit<PrivilegedResponseBindingRequest, "principal">,
  now: number,
): string {
  if (!secret || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return fail();
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return fail();
  const actual = Buffer.from(mac, "base64url"),
    wanted = signature(secret, payload);
  if (actual.length !== wanted.length || !NodeCrypto.timingSafeEqual(actual, wanted)) return fail();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return fail();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    !("principal" in value) ||
    !("hostId" in value) ||
    !("environmentId" in value) ||
    !("method" in value) ||
    !("path" in value) ||
    !("bodySha256" in value) ||
    !("issuedAt" in value) ||
    !("expiresAt" in value)
  )
    return fail();
  const claim = value;
  if (
    claim.v !== 1 ||
    typeof claim.principal !== "string" ||
    typeof claim.hostId !== "string" ||
    typeof claim.environmentId !== "string" ||
    typeof claim.method !== "string" ||
    typeof claim.path !== "string" ||
    typeof claim.bodySha256 !== "string" ||
    typeof claim.issuedAt !== "number" ||
    typeof claim.expiresAt !== "number"
  )
    return fail();
  const request = {
    principal: claim.principal,
    hostId: claim.hostId,
    environmentId: claim.environmentId,
    method: claim.method,
    path: claim.path,
    bodySha256: claim.bodySha256,
  };
  if (
    !validRequest(request) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(claim.issuedAt) ||
    claim.expiresAt !== claim.issuedAt + 30_000 ||
    now < claim.issuedAt ||
    now >= claim.expiresAt ||
    request.hostId !== expected.hostId ||
    request.environmentId !== expected.environmentId ||
    request.method !== expected.method ||
    request.path !== expected.path ||
    request.bodySha256 !== expected.bodySha256
  )
    return fail();
  return request.principal;
}
