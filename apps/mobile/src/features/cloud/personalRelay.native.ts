import Storage from "expo-sqlite/kv-store";
import { PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl } from "@t3tools/shared/sledConnect";

export function savedPersonalRelayUrl(): string | null {
  const value = Storage.getItemSync(PERSONAL_RELAY_STORAGE_KEY);
  return value ? personalRelayUrl(value) : null;
}

export function savePersonalRelayUrl(value: string): void {
  Storage.setItemSync(PERSONAL_RELAY_STORAGE_KEY, personalRelayUrl(value));
}
