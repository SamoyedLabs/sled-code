import { normalizeSecureRelayUrl } from "./relayUrl.ts";
import { clerkFrontendApiUrlFromPublishableKey } from "./relayAuth.ts";

export const PERSONAL_RELAY_STORAGE_KEY = "sled.connect.relay-url";

export function personalRelayUrl(value: string): string {
  const normalized = normalizeSecureRelayUrl(value);
  if (!normalized)
    throw new Error("Enter an HTTPS relay address without a path, query, or password.");
  return normalized;
}

export async function validatePersonalRelay(
  value: string,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const url = personalRelayUrl(value);
  const response = await fetcher(`${url}/.well-known/sled-connect`, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error("The Sled Connect relay did not answer. Check its address and deployment.");
  const config: unknown = await response.json();
  if (
    typeof config !== "object" ||
    config === null ||
    !("protocolVersion" in config) ||
    config.protocolVersion !== 1 ||
    !("relayUrl" in config) ||
    config.relayUrl !== url ||
    !("clerkIssuer" in config) ||
    config.clerkIssuer !== clerkFrontendApiUrlFromPublishableKey(publishableKey)
  )
    throw new Error("This relay is not configured for this Sled sign-in service.");
  return url;
}
