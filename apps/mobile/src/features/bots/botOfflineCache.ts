import { useAuth } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { CredentialStore } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentPresentations } from "../../state/presentation";

const cacheNamespace = "sled.bot-offline-cache.v1";
const encryptionKeyName = "sled.bot.offline.cache.v1";
const keyOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const maxRecordBytes = 512 * 1024;
let encryptionKey: Promise<Crypto.AESEncryptionKey | null> | undefined;

const credentialIdentity = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime.atom((get) => {
    const entry = get(environmentCatalog.catalogValueAtom).entries.get(environmentId);
    const target = entry?.target;
    if (!entry?.enabled || target?._tag !== "BearerConnectionTarget") return Effect.succeed(null);
    return Effect.gen(function* () {
      const store = yield* CredentialStore.ConnectionCredentialStore;
      const credential = Option.getOrNull(yield* store.get(target.connectionId));
      if (!credential) return null;
      return yield* Effect.promise(() =>
        Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, credential.token),
      );
    });
  }),
);
const noCredential = Atom.make(AsyncResult.initial<string | null>());

export function useBotEnvironmentOnline(environmentId: EnvironmentId) {
  return useAtomValue(
    environmentPresentations.presentationsAtom,
    (presentations) => presentations.get(environmentId)?.connection.phase === "connected",
  );
}

/** The current local pairing credential or current Sled Connect account owns this cache. */
export function useBotOfflineScope(environmentId: EnvironmentId | null) {
  const entry = useAtomValue(environmentCatalog.catalogValueAtom, (catalog) =>
    environmentId ? catalog.entries.get(environmentId) : undefined,
  );
  const bearer = entry?.target._tag === "BearerConnectionTarget";
  const phase = useAtomValue(environmentPresentations.presentationsAtom, (presentations) =>
    environmentId ? presentations.get(environmentId)?.connection.phase : undefined,
  );
  const credential = useAtomValue(
    bearer && environmentId ? credentialIdentity(environmentId) : noCredential,
    (result) => (result._tag === "Success" && !result.waiting ? result.value : null),
  );
  const { isLoaded, userId } = useAuth({ treatPendingAsSignedOut: false });
  if (Platform.OS !== "ios" || !entry?.enabled || phase === "error" || phase === "unsupported")
    return null;
  if (bearer) return credential ? JSON.stringify(["pairing", environmentId, credential]) : null;
  if (entry.target._tag === "RelayConnectionTarget" && isLoaded && userId)
    return JSON.stringify(["connect", environmentId, userId]);
  return null;
}

function cacheKey() {
  encryptionKey ??= (async () => {
    const stored = await SecureStore.getItemAsync(encryptionKeyName, keyOptions);
    if (stored) return await Crypto.AESEncryptionKey.import(stored, "base64");
    const created = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
    await SecureStore.setItemAsync(encryptionKeyName, await created.encoded("base64"), keyOptions);
    return created;
  })().catch(() => null);
  const pending = encryptionKey;
  void pending.then((key) => {
    if (key === null && encryptionKey === pending) encryptionKey = undefined;
  });
  return pending;
}

async function recordKey(binding: string) {
  return `${cacheNamespace}.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, binding)}`;
}

function asciiBytes(text: string) {
  const safe = text.replace(
    /[\u007f-\uffff]/g,
    (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const bytes = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i += 1) bytes[i] = safe.charCodeAt(i);
  return bytes;
}

function asciiText(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return text;
}

function privateBinding(scope: string, name: string) {
  return JSON.stringify([cacheNamespace, scope, name]);
}

async function readRecord(binding: string) {
  const sealed = await Storage.getItemAsync(await recordKey(binding));
  if (!sealed) return null;
  if (sealed.length > Math.ceil((maxRecordBytes * 4) / 3) + 128)
    throw new Error("The saved chat record is too large.");
  const key = await cacheKey();
  if (!key) throw new Error("The saved chat record is locked.");
  const bytes = await Crypto.aesDecryptAsync(Crypto.AESSealedData.fromCombined(sealed), key, {
    additionalData: asciiBytes(binding),
    output: "bytes",
  });
  return JSON.parse(asciiText(bytes)) as unknown;
}

export function readBotPrivateRecord(scope: string, name: string) {
  return readRecord(privateBinding(scope, name));
}

export async function storeBotPrivateRecord(scope: string, name: string, value: unknown) {
  const binding = privateBinding(scope, name);
  const clear = asciiBytes(JSON.stringify(value));
  if (clear.length > maxRecordBytes) return false;
  const key = await cacheKey();
  if (!key) return false;
  const sealed = await Crypto.aesEncryptAsync(clear, key, {
    additionalData: asciiBytes(binding),
  });
  await Storage.setItemAsync(await recordKey(binding), await sealed.combined("base64"));
  return true;
}

const writes = new Map<string, Promise<boolean>>();
function writeRecord(scope: string, name: string, value: unknown) {
  const binding = privateBinding(scope, name);
  const previous = writes.get(binding);
  const current = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => storeBotPrivateRecord(scope, name, value));
  writes.set(binding, current);
  const undo = () => {
    if (writes.get(binding) === current) writes.delete(binding);
  };
  void current.then(undo, undo);
}

export function useBotCachedValue<T>({
  scope,
  name,
  live,
  decode,
}: {
  scope: string | null;
  name: string;
  live: T | null;
  decode: (value: unknown) => T | null;
}) {
  const binding = scope ? privateBinding(scope, name) : null;
  const liveAvailable = live !== null;
  const [cached, setCached] = useState<{ binding: string; value: T | null }>();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- An offline snapshot comes from asynchronous device storage and must never cross a changed connection identity.
  useEffect(() => {
    if (!binding || liveAvailable) return;
    let current = true;
    void readRecord(binding)
      .then(decode)
      .then((value) => {
        if (current) setCached({ binding, value });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [binding, decode, liveAvailable]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the last confirmed host response for this pairing.
  useEffect(() => {
    if (!scope || live === null) return;
    writeRecord(scope, name, live);
  }, [scope, name, live]);
  return live ?? (cached?.binding === binding ? cached.value : null);
}
