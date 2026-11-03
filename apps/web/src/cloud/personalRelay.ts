import { PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl } from "@t3tools/shared/sledConnect";

export function savedPersonalRelayUrl(): string | null {
  try {
    const value = localStorage.getItem(PERSONAL_RELAY_STORAGE_KEY);
    return value ? personalRelayUrl(value) : null;
  } catch {
    return null;
  }
}

export function savePersonalRelayUrl(value: string): void {
  localStorage.setItem(PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl(value));
}
