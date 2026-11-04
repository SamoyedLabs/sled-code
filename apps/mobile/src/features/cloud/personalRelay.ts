import { PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl } from "@t3tools/shared/sledConnect";

export function savedPersonalRelayUrl(): string | null {
  const value = globalThis.localStorage?.getItem(PERSONAL_RELAY_STORAGE_KEY);
  return value ? personalRelayUrl(value) : null;
}

export function savePersonalRelayUrl(value: string): void {
  globalThis.localStorage.setItem(PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl(value));
}
