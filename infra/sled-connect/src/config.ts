export interface RelayBindings {
  readonly DB: D1Database;
  readonly RELAY_URL: string;
  readonly CLERK_ISSUER: string;
  readonly CLERK_AUDIENCE: string;
  readonly CLERK_CLI_CLIENT_ID: string;
  readonly OWNER_USER_ID: string;
  readonly TUNNEL_DOMAIN: string;
  readonly CLOUDFLARE_ACCOUNT_ID: string;
  readonly CLOUDFLARE_ZONE_ID: string;
  readonly ALLOWED_ORIGINS: string;
  readonly CLOUDFLARE_API_TOKEN: string;
  readonly MINT_PRIVATE_KEY: string;
  readonly MINT_PUBLIC_KEY: string;
}

// @effect-diagnostics-next-line extendsNativeError:off - The Worker maps thrown HTTP errors outside Effect.
export class RelayError extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(status: number, reason: string) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

export function secureOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new RelayError(500, "invalid_configuration");
  return url.origin;
}

export function validateConfiguration(env: RelayBindings): void {
  secureOrigin(env.RELAY_URL);
  secureOrigin(env.CLERK_ISSUER);
  if (
    !env.OWNER_USER_ID?.startsWith("user_") ||
    !env.CLERK_AUDIENCE ||
    !env.CLERK_CLI_CLIENT_ID ||
    !/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ACCOUNT_ID) ||
    !/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ZONE_ID) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(env.TUNNEL_DOMAIN) ||
    !env.CLOUDFLARE_API_TOKEN ||
    !env.MINT_PRIVATE_KEY ||
    !env.MINT_PUBLIC_KEY
  )
    throw new RelayError(500, "invalid_configuration");
}
