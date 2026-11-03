import { workerNow, workerUuid } from "./platform.ts";
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import { RelayError, secureOrigin, type RelayBindings } from "./config.ts";
import type { RelayStore } from "./store.ts";

const clerkKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function bearer(request: Request, scheme = "Bearer"): string {
  const value = request.headers.get("authorization");
  if (!value?.startsWith(`${scheme} `)) throw new RelayError(401, "authorization_missing");
  return value.slice(scheme.length + 1);
}

export async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class RelaySecurity {
  readonly env: RelayBindings;
  readonly store: RelayStore;
  constructor(env: RelayBindings, store: RelayStore) {
    this.env = env;
    this.store = store;
  }

  async user(token: string): Promise<string> {
    const issuer = secureOrigin(this.env.CLERK_ISSUER);
    let keys = clerkKeys.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
      clerkKeys.set(issuer, keys);
    }
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp"],
      clockTolerance: 5,
    });
    const audiences = typeof payload.aud === "string" ? [payload.aud] : (payload.aud ?? []);
    // Clerk CLI access tokens can omit aud; their signed client_id binds them to Sled.
    const isCli =
      protectedHeader.typ === "at+jwt" && payload.client_id === this.env.CLERK_CLI_CLIENT_ID;
    if (
      payload.sub !== this.env.OWNER_USER_ID ||
      (isCli
        ? payload.aud !== undefined && !audiences.includes(this.env.CLERK_CLI_CLIENT_ID)
        : !audiences.includes(this.env.CLERK_AUDIENCE))
    )
      throw new RelayError(403, "account_not_authorized");
    return payload.sub;
  }

  async sign(typ: string, payload: JWTPayload): Promise<string> {
    const key = await importPKCS8(this.env.MINT_PRIVATE_KEY.replaceAll("\\n", "\n"), "EdDSA");
    return new SignJWT(payload).setProtectedHeader({ alg: "EdDSA", typ }).sign(key);
  }

  async verify(
    token: string,
    typ: string,
    publicKey: string,
    issuer: string,
    audience: string,
    maxAge = 300,
  ) {
    const key = await importSPKI(publicKey.replaceAll("\\n", "\n"), "EdDSA");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      typ,
      issuer,
      audience,
      maxTokenAge: maxAge,
      requiredClaims: ["sub", "jti", "iat", "exp"],
      clockTolerance: 5,
    });
    if (!payload.jti || !payload.exp || !payload.iat || payload.exp - payload.iat > maxAge) {
      throw new RelayError(401, "invalid_proof_lifetime");
    }
    return payload;
  }

  async proof(request: Request, token?: string): Promise<string> {
    const proof = request.headers.get("dpop");
    if (!proof) throw new RelayError(401, "dpop_missing");
    const header = decodeProtectedHeader(proof);
    if (!header.jwk || "d" in header.jwk || header.jwk.kty !== "EC" || header.jwk.crv !== "P-256") {
      throw new RelayError(401, "invalid_dpop_key");
    }
    const { payload } = await jwtVerify(proof, await importJWK(header.jwk, "ES256"), {
      algorithms: ["ES256"],
      typ: "dpop+jwt",
      maxTokenAge: 60,
      requiredClaims: ["jti", "iat", "htm", "htu"],
      clockTolerance: 5,
    });
    const url = new URL(request.url);
    const target = secureOrigin(this.env.RELAY_URL) + url.pathname;
    if (
      payload.htm !== request.method ||
      payload.htu !== target ||
      typeof payload.jti !== "string"
    ) {
      throw new RelayError(401, "invalid_dpop_target");
    }
    if (token) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      if (payload.ath !== encoded) throw new RelayError(401, "invalid_dpop_token");
    }
    const thumbprint = await calculateJwkThumbprint(header.jwk);
    await this.store.consumeNonce(
      `dpop:${thumbprint}:${payload.jti}`,
      Math.floor(workerNow() / 1000) + 120,
    );
    return thumbprint;
  }

  claims(sub: string, ttl = 120, audience = secureOrigin(this.env.RELAY_URL)): JWTPayload {
    const now = Math.floor(workerNow() / 1000);
    return {
      iss: secureOrigin(this.env.RELAY_URL),
      aud: audience,
      sub,
      jti: workerUuid(),
      iat: now,
      exp: now + ttl,
    };
  }

  decode(token: string): JWTPayload {
    return decodeJwt(token);
  }
}
