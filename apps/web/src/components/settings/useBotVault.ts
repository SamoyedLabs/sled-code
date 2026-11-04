import { useEffect, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import {
  OpenbotVaultState,
  OpenbotVaultSecret,
  OpenbotVaultOnePasswordStatus,
  OpenbotVaultBitwardenStatus,
  OpenbotVaultImportResult,
  type OpenbotVaultRequest,
} from "@t3tools/contracts";
import type { VaultExecute } from "@t3tools/client-runtime/openbot/presentation";
const decodeVaultBitwardenStatus = Schema.decodeUnknownSync(OpenbotVaultBitwardenStatus);
const decodeVaultImportResult = Schema.decodeUnknownSync(OpenbotVaultImportResult);
const decodeVaultOnePasswordStatus = Schema.decodeUnknownSync(OpenbotVaultOnePasswordStatus);
const decodeVaultSecret = Schema.decodeUnknownSync(OpenbotVaultSecret);
const decodeVaultState = Schema.decodeUnknownSync(OpenbotVaultState);
export function useBotVault(execute: VaultExecute) {
  const [state, setState] = useState<OpenbotVaultState | null>(null);
  const [onepassword, setOnepassword] = useState<typeof OpenbotVaultOnePasswordStatus.Type | null>(
    null,
  );
  const [bitwarden, setBitwarden] = useState<typeof OpenbotVaultBitwardenStatus.Type | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const lifetime = useRef(0);
  const alive = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Invalidate in-flight private responses when this host panel unmounts.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      lifetime.current += 1;
    };
  }, []);
  const run = async (
    request: OpenbotVaultRequest,
    consume?: (secret: string) => Promise<void> | void,
  ) => {
    if (lock.current || !alive.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const generation = lifetime.current;
    const success = await execute(request)
      .then(async (result) => {
        if (generation !== lifetime.current) return false;
        if (!result.ok) {
          setError("The host could not complete the vault request. Refresh before retrying.");
          return false;
        }
        if (request.operation === "vault.reveal") {
          const secret = decodeVaultSecret(result.value);
          if (consume) await consume(secret.value);
        } else if (request.operation.startsWith("vault.onepassword."))
          setOnepassword(decodeVaultOnePasswordStatus(result.value));
        else if (request.operation.startsWith("vault.bitwarden."))
          setBitwarden(decodeVaultBitwardenStatus(result.value));
        else if (request.operation === "vault.import") {
          const counts = decodeVaultImportResult(result.value);
          setNotice(
            `Imported ${counts.imported}; skipped ${counts.skipped}. Refresh the vault list.`,
          );
        } else setState(decodeVaultState(result.value));
        return true;
      })
      .catch(() => {
        if (generation === lifetime.current)
          setError(
            "The vault request failed or returned unsupported data. Refresh before retrying.",
          );
        return false;
      });
    lock.current = false;
    if (generation === lifetime.current) setBusy(false);
    return success;
  };
  return {
    state,
    onepassword,
    bitwarden,
    busy,
    error,
    notice,
    run,
    isActive: () => alive.current,
    clearState: () => setState(null),
  };
}
export type VaultController = ReturnType<typeof useBotVault>;
