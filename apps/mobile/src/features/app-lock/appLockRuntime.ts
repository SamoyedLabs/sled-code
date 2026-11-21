import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { requireOptionalNativeModule } from "expo";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import { APP_LOCK_DELAYS, nextAppPinAttempt, requiresAppRelock } from "./appLockPolicy";

type Away = { awayMs: number | null; phoneLocked: boolean };
const native =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<{
        configure(enabled: boolean, watchPhoneLock: boolean): Promise<void>;
        takeAway(): Promise<Away>;
        derivePin(pin: string, salt: string, iterations: number): Promise<string>;
        deviceUnlockKind(): Promise<string | null>;
        authenticate(reason: string): Promise<boolean>;
      }>("SledAppLock")
    : null;

const Pin = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  salt: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/u)),
  iterations: Schema.Int.check(Schema.isBetween({ minimum: 2_000, maximum: 30_000 })),
});
const Config = Schema.Struct({
  pin: Schema.NullOr(Pin),
  useDevice: Schema.Boolean,
  delay: Schema.Literals(APP_LOCK_DELAYS),
  lockWithPhone: Schema.Boolean,
  failures: Schema.Struct({
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    last: Schema.Finite,
  }),
});
type Config = typeof Config.Type;
type Status = "loading" | "ready" | "failed";
const ZERO_ATTEMPTS = { count: 0, last: 0 };
const DEFAULT_CONFIG: Config = {
  pin: null,
  useDevice: false,
  delay: 60_000,
  lockWithPhone: true,
  failures: ZERO_ATTEMPTS,
};
const storageKey = "sled.mobile.app-lock.v1";
const keyOptions = {
  keychainService: "sled.mobile.app-lock",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Config));
const listeners = new Set<() => void>();
let state: {
  status: Status;
  config: Config;
  locked: boolean;
  covered: boolean;
  confirming: boolean;
} = {
  status: Platform.OS === "ios" ? "loading" : "ready",
  config: DEFAULT_CONFIG,
  locked: false,
  covered: false,
  confirming: false,
};
let awaySince: number | null = null;
let confirmation: ((accepted: boolean) => void) | null = null;
let allowedUntil = 0;
let heldNavigation: (() => void) | null = null;
let authenticating = false;
let loading = false;
let foregroundVersion = 0;
let queue = Promise.resolve<unknown>(undefined);

const active = (config: Config) => config.pin !== null || config.useDevice;
function update(next: Partial<typeof state>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const useMobileAppLock = () => useSyncExternalStore(subscribe, () => state);
const blockNavigation = () => state.status !== "ready" || state.locked || state.covered;
export function whenMobileAppUnlocked(action: () => void) {
  if (blockNavigation()) heldNavigation = action;
  else action();
}
function releaseNavigation() {
  if (blockNavigation()) return;
  const action = heldNavigation;
  heldNavigation = null;
  action?.();
}
function respondToConfirmation(accepted: boolean) {
  const pending = confirmation;
  confirmation = null;
  pending?.(accepted);
}
function lock() {
  Keyboard.dismiss();
  allowedUntil = 0;
  respondToConfirmation(false);
  update({ confirming: false, locked: true });
}
function unlock() {
  allowedUntil = Date.now() + 5 * 60_000;
  update({ locked: false, confirming: false, covered: AppState.currentState !== "active" });
  respondToConfirmation(true);
  releaseNavigation();
}

async function save(config: Config) {
  await SecureStore.setItemAsync(storageKey, JSON.stringify(config), keyOptions);
  update({ config });
}
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
function applyNativeSignals(config: Config) {
  return native?.configure(active(config), config.lockWithPhone).catch(() => {});
}
export async function loadMobileAppLock() {
  if (Platform.OS !== "ios" || loading) return;
  loading = true;
  try {
    const stored = await SecureStore.getItemAsync(storageKey, keyOptions);
    const config = stored === null ? DEFAULT_CONFIG : decode(stored);
    if (active(config)) lock();
    update({
      config,
      status: "ready",
      locked: active(config),
      covered: active(config) && AppState.currentState !== "active",
    });
    await applyNativeSignals(config);
    releaseNavigation();
  } catch {
    update({ status: "failed", locked: true });
  } finally {
    loading = false;
  }
}
async function checkReturn() {
  const version = ++foregroundVersion;
  const start = awaySince;
  awaySince = null;
  const fallback = { awayMs: start === null ? null : Date.now() - start, phoneLocked: false };
  const signals = await native?.takeAway().catch(() => null);
  if (version !== foregroundVersion || AppState.currentState !== "active") return;
  const away = {
    awayMs: signals?.awayMs ?? fallback.awayMs,
    phoneLocked: signals?.phoneLocked ?? false,
  };
  if (state.status === "ready" && active(state.config) && requiresAppRelock(state.config, away))
    lock();
  update({ covered: false });
  releaseNavigation();
}
export function installMobileAppLock() {
  if (Platform.OS !== "ios") return () => {};
  void loadMobileAppLock();
  const listener = AppState.addEventListener("change", (next) => {
    if (next !== "active") {
      foregroundVersion++;
      awaySince ??= Date.now();
      if (active(state.config)) update({ covered: true });
    } else if (authenticating) {
      return;
    } else if (state.status === "failed") {
      void loadMobileAppLock();
    } else {
      void checkReturn();
    }
  });
  return () => listener.remove();
}

export function confirmMobileAppOwner() {
  if (state.status !== "ready" || state.locked) return Promise.resolve(false);
  if (!active(state.config) || Date.now() < allowedUntil) return Promise.resolve(true);
  respondToConfirmation(false);
  return new Promise<boolean>((resolve) => {
    confirmation = resolve;
    update({ locked: true, confirming: true });
  });
}
export function dismissMobileAppOwnerConfirmation() {
  if (!state.confirming) return;
  respondToConfirmation(false);
  update({ locked: false, confirming: false });
  releaseNavigation();
}
export const mobileAppUnlockKind = () =>
  native?.deviceUnlockKind().catch(() => null) ?? Promise.resolve(null);
export async function confirmWithMobileDevice(prompt: string) {
  if (authenticating || !native) return false;
  authenticating = true;
  let accepted = false;
  try {
    accepted = await native.authenticate(prompt);
    return accepted;
  } catch {
    return false;
  } finally {
    authenticating = false;
    if (AppState.currentState === "active") {
      if (accepted) {
        awaySince = null;
        await native.takeAway().catch(() => null);
        update({ covered: false });
        releaseNavigation();
      } else {
        await checkReturn();
      }
    }
  }
}
export async function unlockMobileAppWithDevice() {
  if (state.status !== "ready" || !state.locked) return false;
  if (!(await confirmWithMobileDevice("Unlock Sled"))) return false;
  await serial(async () => {
    await save({ ...state.config, failures: ZERO_ATTEMPTS });
  });
  unlock();
  return true;
}
function checkOwner() {
  if (
    state.status !== "ready" ||
    state.locked ||
    (active(state.config) && Date.now() >= allowedUntil)
  )
    throw new Error("Unlock Sled before changing App Lock.");
}
async function derive(pin: string, salt: string, iterations: number) {
  return native
    ? native.derivePin(pin, salt, iterations)
    : bytesToHex(
        await pbkdf2Async(sha256, utf8ToBytes(pin), hexToBytes(salt), { c: iterations, dkLen: 32 }),
      );
}
const validPin = (pin: string) => /^[0-9]{4}$/u.test(pin);
export const saveMobileAppLock = (
  patch: Partial<Pick<Config, "useDevice" | "delay" | "lockWithPhone">>,
) =>
  serial(async () => {
    checkOwner();
    const config = { ...state.config, ...patch };
    await save(config);
    allowedUntil = Date.now() + 5 * 60_000;
    await applyNativeSignals(config);
  });
export const setMobileAppPin = (pin: string | null) =>
  serial(async () => {
    checkOwner();
    let next: Config["pin"] = null;
    if (pin !== null) {
      if (!validPin(pin)) throw new Error("Enter a four-digit PIN.");
      const salt = bytesToHex(getRandomBytes(16));
      const iterations = native ? 30_000 : 2_000;
      next = { salt, iterations, hash: await derive(pin, salt, iterations) };
    }
    const config = { ...state.config, pin: next, failures: ZERO_ATTEMPTS };
    await save(config);
    allowedUntil = Date.now() + 5 * 60_000;
    await applyNativeSignals(config);
  });

export const unlockMobileAppWithPin = (pin: string) =>
  serial(async () => {
    const config = state.config;
    if (!state.locked || !config.pin || !validPin(pin)) return false;
    const now = Date.now();
    if (nextAppPinAttempt(config.failures, now) > now) return false;
    // Persist before checking, so leaving the app cannot clear a failed attempt.
    await save({ ...config, failures: { count: config.failures.count + 1, last: now } });
    const candidate = await derive(pin, config.pin.salt, config.pin.iterations);
    let difference = candidate.length ^ config.pin.hash.length;
    for (let i = 0; i < config.pin.hash.length; i++)
      difference |= candidate.charCodeAt(i) ^ config.pin.hash.charCodeAt(i);
    if (difference !== 0) return false;
    await save({ ...config, failures: ZERO_ATTEMPTS });
    unlock();
    return true;
  });

export const repairAppPinClock = (now: number) =>
  serial(async () => {
    const config = state.config;
    if (config.failures.count <= 4 || now >= config.failures.last) return;
    await save({ ...config, failures: { ...config.failures, last: now } });
  });
